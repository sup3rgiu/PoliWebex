# PoliWebex

## Saves WebEx videos uploaded by Politecnico di Milano.

Features:
 - PoliMi autologin
 - Multithreading download through aria2c


## PREREQS

* [**Node.js**](https://nodejs.org/it/download/): anything above v8.0 seems to work.
* [**aria2**](https://github.com/aria2/aria2/releases): this needs to be in your `$PATH` (for example, copy aria2c.exe to c:\windows). PoliWebex calls `aria2c` with a bunch of arguments in order to improve the download speed.
* [**ffmpeg**](https://www.ffmpeg.org/download.html): a recent version (year 2019 or above), in [`$PATH`](https://www.thewindowsclub.com/how-to-install-ffmpeg-on-windows-10).

## Windows Installation instructions
(On others OS is pretty much the same)

This tutorial comes from my other project [PoliDown](https://github.com/sup3rgiu/PoliDown). The installation process is the same, just use clone this repo (and not PoliDown repo) and write "poliwebex" where in the video appear "polidown"

[![https://user-images.githubusercontent.com/7725068/76635047-21a89080-6547-11ea-8da9-31831ca7620a.png](https://user-images.githubusercontent.com/7725068/76635345-a1cef600-6547-11ea-991b-d115946ed556.png)](http://www.youtube.com/watch?v=iZgea4t5YW4 "PoliDown Windows Installation Instructions")


## USAGE

* Clone this repo
* `cd` into the cloned folder
* `npm install` to install dependencies

### COMMAND LINE USAGE

Default usage:
```
$ node poliwebex --videoUrls "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1"

$ node poliwebex -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1"
```

Show options:
```
$ node poliwebex -h

Options:
  --version                  Show version number                       [boolean]
  -v, --videoUrls                                                        [array]
  -f, --videoUrlsFile    Path to txt file containing the URLs (one URL for each line) [string]
  -p, --password                                                        [string]
  -s, --segmented            Download video in a segmented way. Could be (a lot)
                             faster on powerful PC with good download speed [boolean] [default: false]
  -o, --outputDirectory                             [string] [default: "videos"]
  -k, --noKeyring            Do not use system keyring [boolean] [default: false]
  -t, --noToastNotification  Disable toast notification [boolean] [default: false]
  -i, --timeout              Scale timeout by a factor X                [number]
  -w, --videoPwd             Video Password               [string] [default: ""]
  -h, --help                 Show help                                 [boolean]
```

Multiple videos download:
```
$ node poliwebex -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-2"
```

Download from TXT file (one link each line):
```
$ node poliwebex -f "/my/path/here/links.txt"
```

Output directory (relative or absoulte path):
```
$ node poliwebex -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" -o "/my/path/here"
```

Replace saved password
```
$ node poliwebex -p MYNEWPASSWORD -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1"
```

Download the video in a segmented way. Could be (a lot) faster on powerful PC with good download speed
```
$ node poliwebex  -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" -s
```

Download password-protected video
```
$ node poliwebex  -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" -w PASSWORD
```

Scale timeout values by a factor X (integer or float value). Really useful for slow connections while performing login operations
```
$ node poliwebex  -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" -i X
```

Do not use system keyring to save the password:
```
$ node poliwebex -v "https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/VIDEO-1" -k
```

You can omit the password argument. PoliWebex will ask for it interactively and then save it securely in system's keychain for the next use.

## EXPECTED OUTPUT

```
Project powered by @sup3rgiu
Features: PoliMi Autologin - Multithreading download
Using aria2 version 1.35.0
Using ffmpeg version git-2020-03-06-cfd9a65 Copyright (c) 2000-2020 the FFmpeg developers

Video URLs: [
  'https://politecnicomilano.webex.com/webappng/sites/politecnicomilano/recording/play/b569e996f56740a3bc9bfd2637713779'
]
Output Directory: videos

Reusing password saved in system's keychain!

Launching headless Chrome to perform the OpenID Connect dance...
Navigating to WebEx login page...
Filling in Servizi Online login form...
We are logged in.
Got required authentication cookies.

At this point Chrome's job is done, shutting it down...

Video title is: Lesson number 1 - The cat is on the table

03/10 20:47:14 [NOTICE] Downloading 898 item(s)

[...]

Done!
```

The video is now saved under `videos/`, or whatever the `outputDirectory` argument points to.
