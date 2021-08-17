"use strict";

const execSync = require('child_process').execSync;
const puppeteer = require("puppeteer");
const term = require("terminal-kit").terminal;
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const request = require('request');
const notifier = require('node-notifier');
var xml2js = require('xml2js');
var URL = require('url').URL; // for node.js version <= 8

const argv = yargs.options({
    v: { alias:'videoUrls', type: 'array', demandOption: false },
    f: { alias: 'videoUrlsFile', type: 'string', demandOption: false, describe: 'Path to txt file containing the URLs (one URL for each line)'},
    p: { alias:'password', type: 'string', demandOption: false },
    s: { alias:'segmented', type: 'boolean', default:false, demandOption: false, describe: 'Download video in a segmented way. Could be (a lot) faster on powerful PC with good download speed' },
    o: { alias:'outputDirectory', type: 'string', default: 'videos' },
    k: { alias: 'noKeyring', type: 'boolean', default: false, demandOption: false, describe: 'Do not use system keyring'},
    t: { alias: 'noToastNotification', type: 'boolean', default: false, demandOption: false, describe: 'Disable toast notification'},
    i: { alias: 'timeout', type: 'number', demandOption: false, describe: 'Scale timeout by a factor X'},
    w: { alias: 'videoPwd', type: 'string', default: '', demandOption: false, describe: 'Video Password'}
})
.help('h')
.alias('h', 'help')
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607"\n', "Standard usage")
.example('node $0 -f URLsList.txt\n', "Standard usage")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/9ce59ddr5a0345c6b525ed45a2c50607"\n', "Multiple videos download")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -o "C:\\Lessons\\Videos"\n', "Define output directory (absoulte o relative path)")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -s\n', "Download video in a segmented way. Could be (a lot) faster on powerful PC with good download speed")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -w PASSWORD\n', "Download password-protected video")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -i 2\n', "Double timeout value")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -k\n', "Do not save the password into system keyring")
.example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -t\n', "Disable system toast notification about finished download process")
.argv;

function sanityChecks() {
    try {
        const aria2Ver = execSync('aria2c --version').toString().split('\n')[0];
        term.green(`Using ${aria2Ver}\n`);
    } catch (e) {
        term.red('You need aria2c in $PATH for this to work. Make sure it is a relatively recent one.');
        process.exit(22);
    }
    try {
        const ffmpegVer = execSync('ffmpeg -version').toString().split('\n')[0];
        term.green(`Using ${ffmpegVer}\n\n`);
    } catch (e) {
        term.red('FFmpeg is missing. You need a fairly recent release of FFmpeg in $PATH.');
        process.exit(23);
    }
    if (argv.videoUrls === undefined && argv.videoUrlsFile === undefined) {
        term.red("Missing URLs arguments.\n");
        process.exit();
    }
    if (argv.videoUrls !== undefined && argv.videoUrlsFile !== undefined) {
        term.red("Can't get URLs from both argument.\n");
        process.exit();
    }
    if (argv.videoUrlsFile !== undefined)
        argv.videoUrls = argv.videoUrlsFile; // merge argument

    if (argv.timeout !== undefined) {
        if(isNaN(argv.timeout) || argv.timeout < 0) {
            term.red("Incorrect timeout value. Insert a positive integer or float.\n");
            process.exit();
        } else {
            if(argv.timeout > 10) {
                term.red("This is a really big scale factor for the timeout value...\n");
                process.exit();
            } else {
                timeout = argv.timeout;
            }
        }
    }


    if (!fs.existsSync(argv.outputDirectory)) {
        if (path.isAbsolute(argv.outputDirectory) || argv.outputDirectory[0] == '~') console.log('Creating output directory: ' + argv.outputDirectory);
        else console.log('Creating output directory: ' + process.cwd() + path.sep + argv.outputDirectory);
        try {
            fs.mkdirSync(argv.outputDirectory, {
                recursive: true
            }); // use native API for nested directory. No recursive function needed, but compatible only with node v10 or later
        } catch (e) {
            term.red("Can not create nested directories. Node v10 or later is required\n");
            process.exit();
        }
    }

}

function readFileToArray(path) {
    path = path.substr(1, path.length - 2);
    if (process.platform === "win32") //check OS
        return fs.readFileSync(path).toString('utf-8').split('\r\n'); //Windows procedure
    return fs.readFileSync(path).toString('utf-8').split('\n'); //Bash procedure
}

function parseVideoUrls(videoUrls) {
    let stringVideoUrls = JSON.stringify(videoUrls);
    if (stringVideoUrls.substr(stringVideoUrls.length - 5) == ".txt\"") // is path?
        return readFileToArray(stringVideoUrls);
    return videoUrls;
}

const notDownloaded = []; // take trace of not downloaded videos
var timeout = 1;

async function downloadVideo(videoUrls, password, outputDirectory, videoPwd) {

    var credentials = await askForCredentials(password);
    console.log('\nLaunching headless Chrome to perform the OpenID Connect dance...');
    const browser = await puppeteer.launch({
        // Switch to false if you need to login interactively
        headless: true,
        args: ['--disable-dev-shm-usage', '--lang=it-IT']
    });

    if (argv.timeout !== undefined) {
        timeout = argv.timeout;
    }

    var page = await login(credentials, browser);
    await sleep(3000*timeout)
    const cookie = await extractCookies(page)
    //console.log(cookie);
    console.log('Got required authentication cookies.');
    console.log("\nAt this point Chrome's job is done, shutting it down...");
    await browser.close(); // browser is no more required. Free up RAM!

    var headers = {
        'Cookie': cookie,
        'accessPwd': videoPwd
    };

    for (let videoUrl of videoUrls) {
        if (videoUrl == "") continue; // jump empty url
        term.green(`\nStart downloading video: ${videoUrl}\n`);

        try {

            if(extractRCID(videoUrl) != null) { // check if the videoUrl is in the new format https://politecnicomilano.webex.com/politecnicomilano/ldr.php?RCID=15abe8b5bcf02a50a20b056cc2263211
                var options = {
                    url: videoUrl,
                    headers: headers
                };
                var redirectUrl = await getRedirectUrl(options) // get videoUrl in the usual format. Needed to obtain the correct videoID , in order to use in the API
                if(redirectUrl !== null) {
                    videoUrl = redirectUrl;
                }
            }

            var videoID = extractVideoID(videoUrl);
            if (videoID === null) {
                term.red('\nCan\'t find video ID. Going to the next one.\n');
                notDownloaded.push(videoUrl);
                continue;
            }

            var options = {
                url: 'https://politecnicomilano.webex.com/webappng/api/v1/recordings/' + videoID + '/stream?siteurl=politecnicomilano',
                headers: headers
            };
            var response = await doRequest(options);
        } catch (e) {
            term.red('\nUndefined URL request response. Going to the next one.\n');
            notDownloaded.push(videoUrl);
            continue;
        }

        try {
            var obj = JSON.parse(response);
        } catch (e) {
            term.red('\nError downloading this video.\n')
            notDownloaded.push(videoUrl);
            continue;
        }

        var title = (obj.recordName).trim();
        console.log(`\nVideo title is: ${title}`);
        title = title.replace(/[/\\?%*:;|"<>]/g, '-'); // remove illegal characters
        var isoDate = obj.createTime;
        if (isoDate !== null && isoDate !== '') {
            let date = new Date(isoDate);
            let year = date.getFullYear();
            let month = date.getMonth() + 1;
            let dt = date.getDate();

            if (dt < 10) {
                dt = '0' + dt;
            }
            if (month < 10) {
                month = '0' + month;
            }
            let uploadDate = year + '_' + month + '_' + dt;
            title = 'Lesson ' + uploadDate + ' - ' + title;
        } else {
            // console.log("no upload date found");
        }

        const recordingDir = obj.mp4StreamOption.recordingDir
        const timestamp = obj.mp4StreamOption.timestamp
        const token = obj.mp4StreamOption.token

        const html5ApiUrl = 'https://nfg1vss.webex.com/apis/html5-pipeline.do?recordingDir=' + recordingDir + '&timestamp=' + timestamp + '&token=' + token + '&xmlName=recording.xml'

        try {
            var options = {
                url: html5ApiUrl,
            };
            var xmlResponse = await doRequest(options);
        } catch (e) {
            term.red('\nCan\'t get current video XML-URL. Going to the next one.\n');
            notDownloaded.push(videoUrl);
            continue;
        }

        const jsonObj = await xmlToJSON(xmlResponse, {})

        const filename = jsonObj.HTML5Pipeline.RecordingXML[0].Screen[0].Sequence[0]._; // maybe there could be more resolutions here?

        if (!filename.endsWith(".mp4")) {
            term.red('\nCan\'t parse XML correctly. Going to the next one.\n');
            notDownloaded.push(videoUrl);
            continue;
        }

        if (argv.segmented === false) {
            const mp4DirectDownloadUrl = 'https://nfg1vss.webex.com/apis/download.do?recordingDir=' + recordingDir + '&timestamp=' + timestamp + '&token=' + token + '&fileName=' + filename;
            var params = {
                mp4DirectDownloadUrl: mp4DirectDownloadUrl,
                title: title,
                videoUrl: videoUrl,
            }
            await directDownload(params);
        } else {
            const src = 'https://nfg1vss.webex.com/hls-vod/recordingDir/' + recordingDir + '/timestamp/' + timestamp + '/token/' + token + '/fileName/' + filename + '.m3u8'
            var params = {
                src: src,
                title: title,
                videoUrl: videoUrl,
                videoID: videoID
            }
            await segmentedDownload(params);
        }
    }

    if (notDownloaded.length > 0) console.log('\nThese videos have not been downloaded: %s\n', notDownloaded);
    else console.log("\nAll requested videos have been downloaded!\n");
    term.green(`Done!\n`);
    if (argv.noToastNotification === false) {
        require('node-notifier').notify({
            title: 'PoliWebex',
            message: 'DONE! See logs on terminal.',
            appID: "https://nodejs.org/", // Such a smart assignment to avoid SnoreToast start menu link. Don't say to my mother.
        }, function(error, response) { /*console.log(response);*/ });
    }

}

async function login(credentials, browser) {
    const page = await browser.newPage();
    console.log('Navigating to WebEx login page...');
    await page.goto('https://politecnicomilano.webex.com/mw3300/mywebex/login/login.do?siteurl=politecnicomilano-it&viewFrom=modern', {
        waitUntil: 'networkidle2'
    });

    await page.waitForSelector('input[type="email"]');
    await page.keyboard.type(credentials.email);
    await page.click('button[name="btnOK"]');

    console.log('Filling in Servizi Online login form...');
    await page.waitForSelector('input[id="login"]');
    await page.type('input#login', credentials.codicePersona) // mette il codice persona
    await page.type('input#password', credentials.password) // mette la password
    const button = await page.$('button[name="evn_conferma"]');
    await button.evaluate(b => b.click()); // clicca sul tasto "Accedi"

    try {
        await page.waitForSelector('div[class="Message ErrorMessage"]', {
            timeout: 1000*timeout
        });
        term.red('Bad credentials.\nIf you need to change the saved password, add the \'-p\' parameter\nTo change username/email, edit them in the config.json file');
        process.exit(401);
    } catch (error) {
        // tutto ok
    }

    try {
        await page.waitForSelector('button[name="evn_continua"]', {
            timeout: 1000*timeout
        }); // password is expiring
        const button = await page.$('button[name="evn_conferma"]');
        await button.evaluate(b => b.click()); // clicca sul tasto "Accedi"
    } catch (error) {
        // password is not expiring
    }

    try {
        await page.waitForSelector('#dati_applicativi_autorizzazioniXSceltaMatricolaColl', {
            timeout: 2000*timeout
        });
        await page.click('#dati_applicativi_autorizzazioniXSceltaMatricolaColl > tbody > tr:nth-child(1) > td:nth-child(1) > a'); // clicca sulla prima matricola
    } catch (error) {
        // scelta della matricola non apparsa, ok...
    }

    var currentIndex = 0;

    await browser.waitForTarget(target => target.url().includes('politecnicomilano.webex.com/'), {
        timeout: 90000
    });
    console.log('We are logged in. ');
    return page;
}

async function directDownload(params) {
    let times = 5;
    var count = 0;
    while (count < times) { // make aria2 multithreading download more consistent and reliable
        try {

            // download async. I'm Speed
            const fullTitle = params.title + '.mp4';
            var aria2cCmd = 'aria2c -j 16 -x 16 -d "' + argv.outputDirectory + '" -o "' + fullTitle + '" "' + params.mp4DirectDownloadUrl + '"';
            var result = execSync(aria2cCmd, {stdio: 'inherit'});
        } catch (e) {
            term.yellow('\n\nOops! We lost some video fragment! Trying one more time...\n\n');
            count++;
            continue;
        }
        break;
    }
    if (count == times) {
        term.red('\nPersistent errors during the download of the current video. Going to the next one.\n');
        notDownloaded.push(params.videoUrl);
        return;
    }
    return;
}

async function segmentedDownload(params) {
    var full_tmp_dir = path.join(argv.outputDirectory, params.videoID);
    // creates tmp dir
    if (!fs.existsSync(full_tmp_dir)) {
        fs.mkdirSync(full_tmp_dir);
    } else {
        rmDir(full_tmp_dir);
        fs.mkdirSync(full_tmp_dir);
    }

    try {
        var options = {
            url: params.src,
        };
        var response = await doRequest(options);
    } catch (e) {
        term.red('\nCan\'t get current video HLS-URL. Going to the next one.\n');
        notDownloaded.push(params.videoUrl);
        rmDir(full_tmp_dir);
        return;
    }

    var baseUri = (params.src).substring(0, (params.src).lastIndexOf("/") + 1);
    var video_full = await response.replace(new RegExp('(.*\.ts)', 'g'), baseUri + '$1'); // local path to full remote url path
    var video_tmp = await response.replace(new RegExp('(.*\.ts)', 'g'), 'video_segments/$1');
    const video_full_path = path.join(full_tmp_dir, 'video_full.m3u8');
    const video_tmp_path = path.join(full_tmp_dir, 'video_tmp.m3u8');
    const video_segments_path = path.join(full_tmp_dir, 'video_segments');
    let times = 5;
    var count = 0;
    while (count < times) { // make aria2 multithreading download more consistent and reliable
        try {
            fs.writeFileSync(video_full_path, video_full);
            fs.writeFileSync(video_tmp_path, video_tmp);

            // download async. I'm Speed
            var aria2cCmd = 'aria2c -i "' + video_full_path + '" -j 16 -x 16 -d "' + video_segments_path + '" -c'; // '-c' (continue param) -> to download missing segements if download is retried
            var result = execSync(aria2cCmd, {stdio: 'inherit'});
        } catch (e) {
            term.yellow('\n\nOops! We lost some video fragment! Trying to retrieve them...\n\n');
            count++;
            continue;
        }
        break;
    }
    if (count == times) {
        term.red('\nPersistent errors during the download of the current video. Going to the next one.\n');
        notDownloaded.push(params.videoUrl);
        return;
    }

    // *** MERGE  video segements (.ts) in an mp4 file ***

    var title = params.title;
    if (fs.existsSync(path.join(argv.outputDirectory, params.title + '.mp4'))) { // if file already exists, add a random string at the end of filename
        title = title + '-' + Date.now('nano');
    }

    // stupid Windows. Need to find a better way
    var ffmpegCmd = '';
    var ffmpegOpts = {
        stdio: 'inherit'
    };
    if (process.platform === 'win32') {
        ffmpegOpts['cwd'] = full_tmp_dir; // change working directory on windows, otherwise ffmpeg doesn't find the segements (relative paths problem, again, stupid windows. Or stupid me?)
        var outputFullPath = '';
        if (path.isAbsolute(argv.outputDirectory) || argv.outputDirectory[0] == '~')
            outputFullPath = path.join(argv.outputDirectory, title);
        else
            outputFullPath = path.join('..', '..', argv.outputDirectory, title);
        var ffmpegCmd = 'ffmpeg -i ' + 'video_tmp.m3u8' + ' -async 1 -c copy -bsf:a aac_adtstoasc -n "' + outputFullPath + '.mp4"';
    } else {
        var ffmpegCmd = 'ffmpeg -i "' + video_tmp_path + '" -async 1 -c copy -bsf:a aac_adtstoasc -n "' + path.join(argv.outputDirectory, title) + '.mp4"';
    }

    var result = execSync(ffmpegCmd, ffmpegOpts);

    // remove tmp dir
    rmDir(full_tmp_dir);

}


async function askForCredentials(password) {

    var codicePersona = '';
    var email = '';
    var changed = false;
    var info = {}

    if (fs.existsSync('config.json')) {
        let rawdata = fs.readFileSync('config.json');
        info = JSON.parse(rawdata);

        if (info.hasOwnProperty('codicePersona')) {
            codicePersona = info.codicePersona;
        } else {
            codicePersona = await promptQuestion("Person code (codice persona) not saved. Please enter your person code, PoliWebex will not ask for it next time: ");
            info.codicePersona = codicePersona;
            changed = true;
        }

        if (info.hasOwnProperty('email')) {
            email = info.email;
        } else {
            email = await promptQuestion("Email not saved. Please enter your PoliMi email, in format \"name.surname@mail.polimi.it\", PoliWebex will not ask for it next time: ");
            info.email = email;
            changed = true;
        }
    } else {
        codicePersona = await promptQuestion("Person code (codice persona) not saved. Please enter your person code, PoliWebex will not ask for it next time: ");
        info.codicePersona = codicePersona;
        email = await promptQuestion("Email not saved. Please enter your PoliMi email, in format \"name.surname@mail.polimi.it\", PoliWebex will not ask for it next time: ");
        info.email = email;

        changed = true;
    }

    if (changed) {
        var json = JSON.stringify(info, null, 4);
        fs.writeFileSync('config.json', json);
    }

    // handle password
    const keytar = require('keytar');
    //keytar.deletePassword('PoliWebex', username);
    if (password === undefined) { // password not passed as argument
        var password = {};
        if (argv.noKeyring === false) {
            try {
                await keytar.getPassword("PoliWebex", info.codicePersona).then(function(result) {
                    password = result;
                });
                if (password === null) { // no previous password saved
                    password = await promptQuestion("Password not saved. Please enter your password, PoliWebex will not ask for it next time: ");
                    await keytar.setPassword("PoliWebex", info.codicePersona, password);
                } else {
                    console.log("Reusing password saved in system's keychain!")
                }
            } catch (e) {
                console.log("X11 is not installed on this system. PoliWebex can't use keytar to save the password.")
                password = await promptQuestion("No problem, please manually enter your password: ");
            }
        } else {
            password = await promptQuestion("Please enter your password: ");
        }
    } else {
        if (argv.noKeyring === false) {
            try {
                await keytar.setPassword("PoliWebex", info.codicePersona, password);
                console.log("Your password has been saved. Next time, you can avoid entering it!");
            } catch (e) {
                // X11 is missing. Can't use keytar
            }
        }
    }

    info.password = password;
    return info;
}

function doRequest(options) {
    return new Promise(function(resolve, reject) {
        request(options, function(error, res, body) {
            if (!error && (res.statusCode == 200 || res.statusCode == 403)) {
                resolve(body);
            } else {
                reject(error);
            }
        });
    });
}

function xmlToJSON(str, options) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(str, options, (err, jsonObj) => {
            if (err) {
                return reject(err);
            }
            resolve(jsonObj);
        });
    });
}

function extractVideoID(videoUrl) {
    var url = new URL(videoUrl);
    var pathnameArray = url.pathname.split('/');
    for (let part of pathnameArray) {
        if (part.length == 32) {
            return part;
        }
        else if (part.length > 32) {
            var char32 = part.slice(0,32)
            if (char32.match(/^[a-z0-9]+$/i)) // first 32 char are alphanumeric
                return char32;
        }
    }
    return null;
}

function extractRCID(videoUrl) {
    var url = new URL(videoUrl);
    return url.searchParams.get("RCID");
}

async function getRedirectUrl(options) {
    var body = await doRequest(options);
    return body.match(/location\.href='(.*?)';/)[1];
}

function promptResChoice(question, count) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(function(resolve, reject) {
        var ask = function() {
            rl.question(question, function(answer) {
                if (!isNaN(answer) && parseInt(answer) < count && parseInt(answer) >= 0) {
                    resolve(parseInt(answer), reject);
                    rl.close();
                } else {
                    console.log("\n* Wrong * - Please enter a number between 0 and " + (count - 1) + "\n");
                    ask();
                }
            });
        };
        ask();
    });
}

function promptQuestion(question) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(function(resolve, reject) {
        var ask = function() {
            rl.question(question, function(answer) {
                resolve(answer, reject);
                rl.close();
            });
        };
        ask();
    });
}


function rmDir(dir, rmSelf) {
    var files;
    rmSelf = (rmSelf === undefined) ? true : rmSelf;
    dir = dir + "/";
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        console.log("!Oops, directory not exist.");
        return;
    }
    if (files.length > 0) {
        files.forEach(function(x, i) {
            if (fs.statSync(dir + x).isDirectory()) {
                rmDir(dir + x);
            } else {
                fs.unlinkSync(dir + x);
            }
        });
    }
    if (rmSelf) {
        // check if caller wants to delete the directory or just the files in this directory
        fs.rmdirSync(dir);
    }
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractCookies(page) {
    var jar = await page.cookies("https://.webex.com");
    var ticketCookie = jar.filter(c => c.name === 'ticket')[0];
    if (ticketCookie == null) {
        await sleep(5000);
        var jar = await page.cookies("https://.webex.com");
        var tiketCookie = jar.filter(c => c.name === 'ticket')[0];
    }
    if (ticketCookie == null) {
        console.error('Unable to read cookies. Try launching one more time, this is not an exact science.');
        process.exit(88);
    }
    return `ticket=${ticketCookie.value}`;
}

term.brightBlue(`Project powered by @sup3rgiu\nFeatures: PoliMi Autologin - Multithreading download\n`);
sanityChecks();
const videoUrls = parseVideoUrls(argv.videoUrls);
console.info('Video URLs: %s', videoUrls);
//console.info('Password: %s', argv.password);
console.info('Output Directory: %s\n', argv.outputDirectory);
downloadVideo(videoUrls, argv.password, argv.outputDirectory, argv.videoPwd);
