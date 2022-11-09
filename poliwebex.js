"use strict";

const execSync = require('child_process').execSync;
const spawnSync = require('child_process').spawnSync;
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
    v: { alias: 'videoUrls', type: 'array', demandOption: false },
    f: { alias: 'videoUrlsFile', type: 'string', demandOption: false, describe: 'Path to txt file containing the URLs (one URL for each line)' },
    u: { alias: 'SPIDusername', type: 'string', demandOption: false },
    e: { alias: 'polimiEmail', type: 'string', demandOption: false },
    p: { alias: 'SPIDpassword', type: 'string', demandOption: false },
    o: { alias: 'outputDirectory', type: 'string', default: 'videos' },
    k: { alias: 'noKeyring', type: 'boolean', default: false, demandOption: false, describe: 'Do not use system keyring' },
    t: { alias: 'noToastNotification', type: 'boolean', default: false, demandOption: false, describe: 'Disable toast notification' },
    i: { alias: 'timeout', type: 'number', demandOption: false, describe: 'Scale timeout by a factor X' },
    w: { alias: 'videoPwd', type: 'string', default: '', demandOption: false, describe: 'Default video password to use (you will be prompted to input the correct one if it\'s wrong or absent)' },
    x: { alias: 'extract', type: 'boolean', default: false, demandOption: false, describe: 'Just extract the links' }
})
    .help('h')
    .alias('h', 'help')
    .example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607"\n', "Standard usage")
    .example('node $0 -f URLsList.txt\n', "Standard usage")
    .example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/9ce59ddr5a0345c6b525ed45a2c50607"\n', "Multiple videos download")
    .example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -o "C:\\Lessons\\Videos"\n', "Define output directory (absoulte o relative path)")
    .example('node $0 -v "https://politecnicomilano.webex.com/recordingservice/sites/politecnicomilano/recording/playback/8de59dbf0a0345c6b525ed45a2c50607" -w PASSWORD\n', "Download password-protected video without needing to input the password manually")
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
        if (isNaN(argv.timeout) || argv.timeout < 0) {
            term.red("Incorrect timeout value. Insert a positive integer or float.\n");
            process.exit();
        } else {
            if (argv.timeout > 10) {
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
var browser = null;

async function downloadVideo(videoUrls, password, outputDirectory, videoPwd) {


    const recmanUrls = await extractRecmanUrls(videoUrls)
    if (recmanUrls.length > 0) {
        term.yellow('RecMan links have been found. Sadly, we need to login even if cookies are already saved...\n\n');

        for (let recmanUrl of recmanUrls) {
            let webex_urls = await extractRecordingsUrl(recmanUrl)
            videoUrls = videoUrls.concat(webex_urls)
        }

        console.log("\nExtraction complete! At this point Chrome's job is done, shutting it down...\n");
        if (browser != null) { await browser.close(); } // browser is no more required. Free up RAM!

        videoUrls = videoUrls.filter(url => !recmanUrls.includes(url)) // remove recman links not that we extracted the WebEx urls
        if (argv.extract === true) {
            console.log("Extracted links:")
            console.log(videoUrls)
            //The following line should be return if running as part of Poli-DL or process.exit(0) if standalone
            //process.exit(0)
            return
        }
        console.info('Video URLs after extraction: %s\n', videoUrls);
    }

    const cookie = await getCookies(password)


    var headers = {
        'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.66 Safari/537.36",
        'Cookie': cookie,
        'accessPwd': videoPwd
    };

    var headers_json = { // copy headers and add 'Accept'
        ...headers,
        'Accept': "application/json, text/plain, */*"
    };


    for (let videoUrl of videoUrls) {
        if (videoUrl == "") continue; // jump empty url
        term.green(`\nStart downloading video: ${videoUrl}\n`);
        if (!('accessPwd' in headers_json))
            headers_json['accessPwd'] = '';


        if (extractRCID(videoUrl) != null) { // check if the videoUrl is in the new format https://politecnicomilano.webex.com/politecnicomilano/ldr.php?RCID=15abe8b5bcf02a50a20b056cc2263211
            var options = {
                url: videoUrl,
                headers: headers
            };
            var redirectUrl = await getRedirectUrl(options) // get videoUrl in the usual format. Needed to obtain the correct videoID , in order to use in the API
            if (redirectUrl !== null) {
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
            headers: headers_json
        };

        try {
            var obj = JSON.parse(await doRequestAccept404(options));
        } catch (e) {
            term.red('\nError downloading this video. Going to the next one.\n');
            notDownloaded.push(videoUrl);
            continue;
        }

        if (obj.code == 54001) {
            term.yellow('\nThis video does not exist. Going to the next one...\n');
            notDownloaded.push(videoUrl);
            continue;
        }

        while (obj.code == 53005) {
            if (options.headers['accessPwd'] === '') {
                term.yellow('\nThis video is password protected:/' + (obj.recordName).trim() + '\n');
            }
            else {
                term.yellow('\nWrong password!/' + (obj.recordName).trim() + '\n');
            }

            var pwd = await promptQuestion("Please insert the password (or 0 to skip this video): ");
            options.headers['accessPwd'] = pwd;

            if (pwd == 0) {
                term.red('\nSkipped. Going to the next one.\n');
                notDownloaded.push(videoUrl);
                break;
            }

            try {
                obj = JSON.parse(await doRequestAccept404(options));
            } catch (e) {
                if (e.statusCode = 429)
                    term.red('\nToo many incorrect password attempts, please wait some time before trying again. Going to the next one.\n');
                else
                    term.red('\nError downloading this video. Going to the next one.\n');
                notDownloaded.push(videoUrl);
                break;
            }
        }

        //We gave up on the video due to the password.
        if (notDownloaded.includes(videoUrl)) {
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

        var newAPI = false;
        try {
            var options = {
                url: html5ApiUrl,
            };
            var xmlResponse = await doRequest(options);
        } catch (e) {
            if ("mp4URL" in obj.downloadRecordingInfo.downloadInfo || "fallbackPlaySrc" in obj) {
                term.yellow('\nUsing new API version');
                newAPI = true;
            } else {
                term.red('\nCan\'t get current video XML-URL. Going to the next one.\n');
                notDownloaded.push(videoUrl);
                continue;
            }

        }
        var filename = "";
        if (!newAPI) {
            const jsonObj = await xmlToJSON(xmlResponse, {})
            filename = jsonObj.HTML5Pipeline.RecordingXML[0].Screen[0].Sequence[0]._; // maybe there could be more resolutions here?

            if (!filename.endsWith(".mp4")) {
                term.red('\nCan\'t parse XML correctly. Going to the next one.\n');
                notDownloaded.push(videoUrl);
                continue;
            }
        }

        var mp4DirectDownloadUrl_slow;
        if (newAPI) {
            if ("mp4URL" in obj.downloadRecordingInfo.downloadInfo)
                mp4DirectDownloadUrl_slow = obj.downloadRecordingInfo.downloadInfo.mp4URL;
            else
                mp4DirectDownloadUrl_slow = obj.fallbackPlaySrc;
        }
        else {
            mp4DirectDownloadUrl_slow = 'https://nfg1vss.webex.com/apis/download.do?recordingDir=' + recordingDir + '&timestamp=' + timestamp + '&token=' + token + '&fileName=' + filename;
        }

        const mp4DirectDownloadUrl_fast = obj.fallbackPlaySrc;     // new endpoint that can be (ab)used to download the video --> really fast if works, since WebEx itself provides Multithreading on this url
        var params = {
            mp4DirectDownloadUrl_slow: mp4DirectDownloadUrl_slow,
            mp4DirectDownloadUrl_fast: mp4DirectDownloadUrl_fast,
            title: title,
            videoUrl: videoUrl,
        }
        await directDownload(params);
    }

    if (notDownloaded.length > 0) console.log('\nThese videos have not been downloaded: %s\n', notDownloaded);
    else console.log("\nAll requested videos have been downloaded!\n");
    term.green(`Done!\n`);
    if (argv.noToastNotification === false) {
        require('node-notifier').notify({
            title: 'PoliWebex',
            message: 'DONE! See logs on terminal.',
            appID: "https://nodejs.org/", // Such a smart assignment to avoid SnoreToast start menu link. Don't say to my mother.
        }, function (error, response) { /*console.log(response);*/ });
    }

}

async function login(credentials, browser) {
    let page;

    page = (await browser.pages())[0]; // in non-headless mode, there is already a blank page. Reuse it
    if (page == null) { page = await browser.newPage(); } // safe check

    await page.setViewport({ width: 1366, height: 768 }); //set viewport size to enable QR code login on posteID
    console.log('Navigating to WebEx login page...');
    await page.goto('https://politecnicomilano.webex.com/mw3300/mywebex/login/login.do?siteurl=politecnicomilano-it&viewFrom=modern', {
        waitUntil: 'networkidle2'
    });

    await page.waitForSelector('input[type="email"]');
    await page.keyboard.type(credentials.email);
    await page.click('button[name="btnOK"]');

    console.log('Filling in Servizi Online login form...');
    try {
        await page.waitForSelector('input[id="login"]');
    } catch (error) {
        term.red("Timeout from attempting to login. We're already in non-headless mode, so we're kinda screwed.");
        process.exit(4);
    }
    await page.waitForSelector('#spid-idp-button-medium-post');
    await page.click('a[class="italia-it-button ingresso-federato-button-size-m button-spid"]');



    //const button = await page.$('button[name="evn_conferma"]');
    //await button.evaluate(b => b.click()); // clicca sul tasto "Accedi"
    var loginHandling = { "unInput": "username", "pwInput": "password" };
    await browser.waitForTarget(target => {
        var result = isSPIDPage(target.url());
        if (result === true) {
            console.log("No overrides.");
            return true;
        }
        else if (result.hasOwnProperty("pwInput")) {
            loginHandling = result;
            console.log("Overrides.");
            return true;
        }
    }, {
        timeout: 900000
    });

    var handler = page;
    if (loginHandling.hasOwnProperty("iframe")) {
        await page.waitForSelector(loginHandling.iframe);
        const elementHandle = await page.$('div#content iframe');
        handler = await elementHandle.contentFrame();
    }

    await handler.waitForSelector('input[id="' + loginHandling.unInput + '"]');

    await handler.type('input[id="' + loginHandling.unInput + '"]', credentials.SPIDusername)
    await handler.type('input[id="' + loginHandling.pwInput + '"]', credentials.password)

    console.log("input username&pw successfully");


    try {
        await page.waitForSelector('div[class="poli-messages"] > div[class="alert alert-danger"]', {
            timeout: 1000 * timeout
        });
        term.red('Must\'ve clicked on the polimi login button. Error.');
        process.exit(401);
    } catch (error) {
        // tutto ok
    }

    await browser.waitForTarget(target => target.url().includes("polimi.it"), {	//Wait until the user hands control back to polimi
        timeout: 9000000
    });

    try {
        await page.waitForSelector('button[name="evn_continua"]', {
            timeout: 1000 * timeout
        }); // password is expiring
        const button = await page.$('button[name="evn_continua"]');
        await button.evaluate(b => b.click()); // clicca sul tasto "Continua"
    } catch (error) {
        // password is not expiring
    }

    try {
        await page.waitForSelector('#dati_applicativi_autorizzazioniXSceltaMatricolaColl', {
            timeout: 2000 * timeout
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

function isSPIDPage(targetSite) {
    console.log("Checking target...")
    console.log(targetSite)
    const targets = [
        "infocert.it",
        "poste.it",
        "tim.it",
        "sieltecloud.it",
        "aruba.it",
        "namirialtsp.com",
        "register.it",
        "intesa.it",
        "lepida.it",
    ];

    const overrides = [
        {
            "site": "tim.it",
            "unInput": "userid",
            "pwInput": "PASSWORD",
            "iframe": "iframe"
        },
        {
            "site": "namirialtsp.com",
            "unInput": "input_username",
            "pwInput": "input_password"
        },
        {
            "site": "intesa.it",
            "unInput": "MainContent_LoginForm_nome_utente",
            "pwInput": "MainContent_LoginForm_password"
        },
    ];

    for (const site of targets) {
        if (targetSite.includes(site) && !targetSite.includes("spid.polimi.it/spidlogin")) {
            console.log("Match found");
            var override = overrides.filter(o => o.site === site)
            if (override.length > 0) {
                return override[0];
            }
            else
                return true;
        }
    }
    return false;
}

async function directDownload(params) {
    let times = 5;
    var count = 0;
    while (count < times) { // make aria2 multithreading download more consistent and reliable
        try {

            // download async. I'm Speed
            const fullTitle = params.title + '.mp4';
            let mp4DirectDownloadUrl
            if (count < 2) {
                mp4DirectDownloadUrl = params.mp4DirectDownloadUrl_fast
            } else {
                term.yellow('Switching to fallback download URL, slower...\n\n');
                mp4DirectDownloadUrl = params.mp4DirectDownloadUrl_slow // fallback on slow url if the fast one doesn't work multiple times
            }
            var aria2cCmd = 'aria2c -j 16 -x 16 -d "' + argv.outputDirectory + '" -c -o "' + fullTitle + '" "' + mp4DirectDownloadUrl + '"';
            var result = execSync(aria2cCmd, { stdio: 'inherit' });
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

async function extractRecmanUrls(videoUrls) {
    let videoUrlObj;
    const aunicaUrls = [];
    for (let videoUrl of videoUrls) {
        if (videoUrl == "") continue; // jump empty url

        videoUrlObj = new URL(videoUrl)
        if (videoUrlObj.host == 'aunicalogin.polimi.it' || videoUrlObj.host == 'webeep.polimi.it') {       // https://aunicalogin.polimi.it/aunicalogin/getservizio.xml?id_servizio=2294&c_classe_webeep=768632-STD || https://webeep.polimi.it/course/view.php?id=1322&section=3
            aunicaUrls.push(videoUrl)
        }
    }

    return aunicaUrls
}

async function extractRecordingsUrl(aunicalogin_url) {
    var page;
    const webexUrls = []
    if (browser == null) {
        var credentials = await askForCredentials(argv.SPIDpassword);
        await openBrowser()
        page = await login(credentials, browser);
        await sleep(3000 * timeout)
        const cookie = await extractCookies(page) // update WebEx cookies while we're at it.
        await saveCookies(cookie)
    } else {
        page = (await browser.pages())[0];
    }

    term.yellow('\nExtracting WebEx recordings from ' + aunicalogin_url + '\nThis could take a while...\n');

    if ((new URL(aunicalogin_url)).host == 'webeep.polimi.it') {
        aunicalogin_url = await getAunicaUrlFromWebeep(page, aunicalogin_url)
        if (aunicalogin_url == null) { return webexUrls; }
    }

    await page.goto(aunicalogin_url, { waitUntil: 'networkidle2' });

    try { await page.waitForNavigation({ timeout: 7000 * timeout }) } catch (e) { };
    //await page.waitForNavigation();

    const extractedText = await page.$eval('*', (el) => el.innerText);
    //console.log(extractedText)
    await sleep(1000)

    const showAllRecordingsUrl = await page.evaluate(() => {
        const urlArray = Array.from(document.links).map((link) => link.href);
        console.log(urlArray + "\n");
        return urlArray.find((link) => link.includes("action=plen_0"))
    });

    //term.red("Here's the URL: " + showAllRecordingsUrl)

    await page.goto(showAllRecordingsUrl, { waitUntil: 'networkidle2' });

    //await page.waitForNavigation();

    await browser.waitForTarget(target => target.url().includes('recman_frontend'), {
        timeout: 90000
    });

    let recordingsUrl = await page.evaluate(() => {
        let elements = document.getElementsByClassName('TableDati-tbody')[0].getElementsByTagName('a');
        const urlArray = Array.from(elements).map((link) => link.href);
        const uniqueUrlArray = [...new Set(urlArray)];
        return uniqueUrlArray
    });

    const ssl_jsessionid = await extractJSESSIONCookie(page)

    var options = {
        headers: { 'Cookie': ssl_jsessionid, }
    };

    for (let recordingUrl of recordingsUrl) {
        options.url = recordingUrl
        try {
            var response = await doRequest(options)
            const webexUrl = response.match(/location\.href='(.*?)';/)[1];
            webexUrls.push(webexUrl)
        } catch (e) {
            // console.log(e)
        }
    }

    return webexUrls
}


async function getAunicaUrlFromWebeep(page, aunicalogin_url) {
    aunicalogin_url += '&section=3' // add this parameter --> parameter to directly go the the Recordings page
    await page.goto(aunicalogin_url, { waitUntil: 'networkidle2' });
    try {
        await browser.waitForTarget(target => target.url().includes('login/index.php'), {
            timeout: 1000 * timeout
        });
        const xpath_expr = "//a[contains(@href, 'auth')]"
        await page.waitForXPath(xpath_expr);
        const button = (await page.$x(xpath_expr))[0]; // get anchors where href contains "auth" --> login button
        await button.evaluate(b => b.click()); // clicca sul tasto "Polimi login"

    } catch (error) {
        // WeBeep login not needed, already logged
    }

    try { await page.waitForNavigation({ timeout: 2000 * timeout }) } catch (e) { };
    await page.waitForNavigation();

    //const xpath_expr = "//a[contains(@href, '/mod/url/view.php')]"
    const xpath_expr = "//a[contains(., 'Archivio registrazioni') or contains(., 'Recordings archive')]"
    try {
        await page.waitForXPath(xpath_expr, { timeout: 3000 * timeout });
    } catch (e) {
        term.red("\nCan't get the RecMan url. Did you submit the correct WeBeep link?\n")
        return null
    }
    const anchor = (await page.$x(xpath_expr))[0];
    const href = await page.evaluate(a => a.getAttribute('href'), anchor)
    await page.goto(href, { waitUntil: 'networkidle2' });
    let aunicaurl = await page.evaluate(() => {
        let elements = document.getElementById('page-content').getElementsByTagName('a');
        const urlArray = Array.from(elements).map((link) => link.href);
        return urlArray.find((link) => link.includes("aunicalogin.polimi.it/aunicalogin/getservizio.xml"))
    });

    return aunicaurl;
}

async function getCookies(password) {
    let cookie = await getSavedCookies()
    let isValidCookie = await checkCookieValidity(cookie)
    if (cookie != null && isValidCookie) {
        term.brightBlue('Reusing saved cookies. No login required this time :)\n');
    } else {
        cookie = getNewCookies(password)
    }
    return cookie;
}

async function getSavedCookies() {
    return await getConfig('cookie')
}

async function checkCookieValidity(cookie) {
    const checkUrl = 'https://politecnicomilano.webex.com/webappng/api/v1/pmrs/recent' // use an endpoint that requires valid cookies
    var options = {
        url: checkUrl,
        headers: { 'Cookie': cookie, }
    };
    try {
        var response = await doRequest(options)
        try {
            var obj = JSON.parse(response)
            term.yellow("Cookie is valid\n");
            return true //Must be a valid json entry.
        } catch (e) {
            term.red("Cookie is not valid\n");
        }

    } catch (e) {
        //console.log(e.statusCode)
    }
    return false
}

async function getNewCookies(password) {
    var credentials = await askForCredentials(password);
    await openBrowser()

    if (argv.timeout !== undefined) {
        timeout = argv.timeout;
    }

    var page = await login(credentials, browser);
    await sleep(3000 * timeout)
    const cookie = await extractCookies(page)
    //console.log(cookie);
    await saveCookies(cookie)
    console.log('Got required authentication cookies.');
    console.log("\nAt this point Chrome's job is done, shutting it down...");
    await browser.close(); // browser is no more required. Free up RAM!
    return cookie;
}

async function saveCookies(cookies) {
    await addConfig('cookie', cookies)
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

async function extractJSESSIONCookie(page) {
    var jar = await page.cookies("https://www11.ceda.polimi.it");
    var sessionCookie = jar.filter(c => c.name === 'SSL_JSESSIONID')[0];
    if (sessionCookie == null) {
        await sleep(5000);
        var jar = await page.cookies("https://www11.ceda.polimi.it");
        var sessionCookie = jar.filter(c => c.name === 'SSL_JSESSIONID')[0];
    }
    if (sessionCookie == null) {
        console.error('Unable to read session cookie. Try launching one more time, this is not an exact science.');
        process.exit(88);
    }
    return `SSL_JSESSIONID=${sessionCookie.value}`;
}




async function askForCredentials(password) {

    var SPIDusername = (argv.SPIDusername === undefined) ? '' : argv.SPIDusername;
    var email = (argv.polimiEmail === undefined) ? '' : argv.polimiEmail;
    var changed = false;
    var info = {}

    if (fs.existsSync('config.json')) {
        let rawdata = fs.readFileSync('config.json');
        info = JSON.parse(rawdata);

        if (SPIDusername !== '') {
            info.SPIDusername = SPIDusername;
            changed = true;
        } else if (info.hasOwnProperty('SPIDusername')) {
            SPIDusername = info.SPIDusername;
        } else {
            SPIDusername = await promptQuestion("SPID username/e-mail not saved. Please enter your SPID username/e-mail, PoliWebex will not ask for it next time: ");
            info.SPIDusername = SPIDusername;
            changed = true;
        }

        if (email !== '') {
            info.email = email;
            changed = true;
        } else if (info.hasOwnProperty('email')) {
            email = info.email;
        } else {
            email = await promptQuestion("PoliMi email not saved. Please enter your PoliMi email, in format \"name.surname@mail.polimi.it\", PoliWebex will not ask for it next time: ");
            info.email = email;
            changed = true;
        }
    } else {
        if (SPIDusername === '') {
            SPIDusername = await promptQuestion("SPID username/e-mail not saved. Please enter your SPID username/e-mail, PoliWebex will not ask for it next time: ");
        }
        info.SPIDusername = SPIDusername;

        if (email === '') {
            email = await promptQuestion("Email not saved. Please enter your PoliMi email, in format \"name.surname@mail.polimi.it\", PoliWebex will not ask for it next time: ");
        }
        info.email = email;

        changed = true;
    }

    // handle password
    const keytar = require('keytar');
    //keytar.deletePassword('PoliWebex', username);
    if (password === undefined) { // password not passed as argument
        var password = {};
        if (argv.noKeyring === false) {
            try {
                await keytar.getPassword("PoliWebexSPID", info.SPIDusername).then(function (result) {
                    password = result;
                });
                if (password === null) { // no previous password saved
                    password = await promptQuestion("Password not saved. Please enter your SPID password, PoliWebex will not ask for it next time: ");
                    await keytar.setPassword("PoliWebexSPID", info.SPIDusername, password);
                    info.passwordSaved = true;
                    changed = true;
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
                await keytar.setPassword("PoliWebexSPID", info.SPIDusername, password);
                console.log("Your password has been saved. Next time, you can avoid entering it!");
                info.passwordSaved = true;
                changed = true;
            } catch (e) {
                // X11 is missing. Can't use keytar
            }
        }
    }

    if (changed) {
        info.SPID = true;
        var json = JSON.stringify(info, null, 4);
        fs.writeFileSync('config.json', json);
    }

    info.password = password;
    return info;
}


async function addConfig(key, value) {
    var info = {}

    if (fs.existsSync('config.json')) {
        let rawdata = fs.readFileSync('config.json');
        info = JSON.parse(rawdata)
    }

    info[key] = value
    var json = JSON.stringify(info, null, 4);
    fs.writeFileSync('config.json', json);
}

async function getConfig(key) {
    if (fs.existsSync('config.json')) {
        let rawdata = fs.readFileSync('config.json');
        var info = JSON.parse(rawdata);

        if (info.hasOwnProperty(key)) {
            return info[key]
        }
    }
    return null;
}

async function openBrowser() {
    if (browser !== null) { return; } // browser already running
    console.log('\nLaunching Chrome to perform the OpenID Connect dance...');

    var executablePath =
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        (process.pkg
            ? path.join(
                path.dirname(process.execPath),
                'puppeteer',
                ...puppeteer
                    .executablePath()
                    .split(path.sep)
                    .slice(puppeteer.executablePath().split(path.sep).indexOf('.local-chromium') + 1), // /snapshot/project/node_modules/puppeteer/.local-chromium
            )
            : puppeteer.executablePath());

    browser = await puppeteer.launch({
        executablePath: executablePath,
        headless: false,
        args: ['--disable-dev-shm-usage', '--lang=it-IT']
    });
}


function doRequest(options) {
    return doRequestMain(options, false)
}

function doRequestAccept404(options) {
    return doRequestMain(options, true)
}

function doRequestMain(options, accept404) {
    return new Promise(function (resolve, reject) {
        request(options, function (error, res, body) {
            if (!error && (res.statusCode == 200 || res.statusCode == 403 || (accept404 && res.statusCode == 404))) {
                resolve(body);
            } else {
                if (!error) { // not an error but statusCode is not in the accepted ones
                    reject({ statusCode: res.statusCode });
                } else {
                    reject(error);
                }

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
            var char32 = part.slice(0, 32)
            if (char32.match(/^[a-z0-9]+$/i)) // first 32 char are alphanumeric
                return char32;
        }
    }
    return null;
}

function extractRCID(videoUrl) {
    var url = new URL(videoUrl);
    return url.searchParams.get("RCID") || url.searchParams.get("rcid");
}

async function getRedirectUrl(options) {
    var body = await doRequest(options);
    return body.match(/location\.href='(.*?)';/)[1];
}
function promptChoice(question, count) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(function (resolve, reject) {
        var ask = function () {
            rl.question(question, function (answer) {
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

    return new Promise(function (resolve, reject) {
        var ask = function () {
            rl.question(question, function (answer) {
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
        files.forEach(function (x, i) {
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


term.brightBlue(`Project powered by @sup3rgiu\nFeatures: PoliMi Autologin - Multithreading download\n`);
sanityChecks();
const videoUrls = parseVideoUrls(argv.videoUrls);
console.info('Video URLs: %s', videoUrls);
//console.info('Password: %s', argv.password);
console.info('Output Directory: %s\n', argv.outputDirectory);
downloadVideo(videoUrls, argv.SPIDpassword, argv.outputDirectory, argv.videoPwd);
