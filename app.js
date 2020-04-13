const async_mutex = require('async-mutex');
const aws = require("aws-sdk");
const circular_buffer = require("circular-buffer");
const config = require('./config.json')
const express = require('express');
const favicon = require('serve-favicon');
const fs = require('fs');
const http = require('http');
const minecraft_ping = require('minecraft-server-util');
const node_ssh = require('node-ssh');
const path = require('path');

aws.config.loadFromPath(config['awsConfigFile']);
let ec2 = new aws.EC2({apiVersion: 'latest'});

let ssh = null;
const sshConnectionMutex = new async_mutex.Mutex();
function getOpenSshSession(callbackSuccess, callbackError) {
    sshConnectionMutex.acquire()
    .then(function(release) {
        if (ssh == null || ssh.connection == null) {
            ssh = new node_ssh();
            ssh.connect({
               host: config['instanceSshHost'],
               username: config['instanceSshUsername'],
               privateKey: fs.readFileSync(config['instanceSshPemFile'], 'utf8'),
               readyTimeout: config['instanceSshConnectTimeout']
            })
            .then(function() {
                if (ssh.connection != null) {
                    callbackSuccess(ssh);
                    release();
                }
            }).catch(error => {
                callbackError(error)
                release();
            });
        }
        else {
            callbackSuccess(ssh);
            release();
        }
    });
}

function remoteExec(command, logsOut, callbackSuccess, callbackError) {
    getOpenSshSession(
        function(ssh) {
            ssh.exec(command, [], {
                cwd: '/home/ubuntu',
                onStdout(chunk) {
                    if (logsOut != null) { logsOut.push(chunk.toString('utf8')); }
                },
                onStderr(chunk) {
                    if (logsOut != null) { logsOut.push(chunk.toString('utf8')); }
                },
            }).then(function() {
                callbackSuccess();
            }).catch(error => {
                callbackError(error)
            })
        },
        function(error) {
            callbackError(error);
        }
    );
}

let app = express();

app.use(express.static('public'));

app.use(favicon('public/images/favicon.ico'));

app.get('/server-name', function(req, res) {
    res.setHeader('Content-Type', 'text/plain');
    res.end(config['title']);
});

app.get('/service-name', function(req, res) {
    res.setHeader('Content-Type', 'text/plain');
    res.end(config['serviceName']);
});

let serverStatus = 'unknown'
app.get('/server-status', function(req, res) {
    res.setHeader('Content-Type', 'text/plain');
    res.end(serverStatus);
});

app.get('/boot', function(req, res) {
    postponeShutdown();
    serviceStatus = 'unknown';
    ec2.startInstances({ InstanceIds: [config['instanceId']] }, function(err, data) {
        let content = ""
        if (err){
            console.log(err, err.stack);
            content = "error"
        }
        else {
            console.log(JSON.stringify(data));
            content = JSON.stringify(data);
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(content);
    });
});

function shutdown(resultCallback) {
    ec2.stopInstances({ InstanceIds: [config['instanceId']] }, function(err, data) {
        let content = ""
        if (err){
            console.log(err, err.stack);
            content = "error"
        }
        else {
            console.log(JSON.stringify(data));
            content = JSON.stringify(data);
        }

        resultCallback(content);

    });
}
app.get('/shutdown', function(req, res) {
    shutdown(function(result) {
        res.setHeader('Content-Type', 'application/json');
        res.end(content);
    });
});

let serviceStatus = 'unknown';
let serviceUsers = 0;
app.get('/service-status', function(req, res) {
    res.setHeader('Content-Type', 'plain/text');
    res.end(serviceStatus);
});

app.get('/service-nbr-users', function(req, res) {
    res.setHeader('Content-Type', 'plain/text');
    res.end(serviceUsers.toString());
});

app.get('/start', function(req, res) {
    postponeShutdown();
    remoteExec('./start.sh', null,
        function(output) {
            res.setHeader('Content-Type', 'plain/text');
            res.end('ok');
        },
        function(error) {
            console.log(error);
        }
    );
});

app.get('/stop', function(req, res) {
    remoteExec('./stop.sh', null,
        function(output) {
            res.setHeader('Content-Type', 'plain/text');
            res.end('ok');
        },
        function(error) {
            console.log(error);
        }
    );
});

app.get('/kill', function(req, res) {
    remoteExec('./kill.sh', null,
        function(output) {
            res.setHeader('Content-Type', 'plain/text');
            res.end('ok');
        },
        function(error) {
            console.log(error);
        }
    );
});

app.get('/connect-instructions', function(req, res) {
    res.setHeader('Content-Type', 'plain/text');
    res.end('ssh -i <a href="' + path.basename(config['instanceSshPemFile']) + '">' +
        path.basename(config['instanceSshPemFile']) + '</a> ' +
        config['instanceSshUsername'] + '@' + config['instanceSshHost']);
})

let lastReceivedPostponeTimeStamp = Date.now();
function postponeShutdown() {
    lastReceivedPostponeTimeStamp = Date.now();
}
function timeBeforeShutdown() {
    return lastReceivedPostponeTimeStamp + config['instanceInactivityTimeout'] - Date.now();
}

app.get('/server-shutdown-countdown', function(req, res) {
    res.setHeader('Content-Type', 'plain/text');
    res.end(timeBeforeShutdown().toString());
})

app.get('/' + path.basename(config['instanceSshPemFile']), function(req, res) {
    res.download(config['instanceSshPemFile'], path.basename(config['instanceSshPemFile']));
});

// Fetch logs from the server
let logs = new circular_buffer(100);
app.get('/logs', function(req, res) {
    res.setHeader('Content-Type', 'plain/text');
    res.end(logs.toarray().join('').replace(/(\r\n|\n|\r)/gm,'<br>'));
});
async function readLogsForever() {
    while (true) {
        await readLogs();
        await sleep(10000);
    }
}
function readLogs() {
  return new Promise(resolve => {
    remoteExec('./logs.sh', logs,
        function(output) { resolve(output); },
        function(error) { resolve(""); },
    );
  });
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
readLogsForever();

async function monitorServerForever() {
    while (true) {
        await fetchServerStatus().then(function(status){ serverStatus = status; } );
        if (serverStatus == "running") {
            if (timeBeforeShutdown() > 0) {
                await fetchServiceStatus().then(function(status) { serviceStatus = status; });
                await fetchMinecraftStats().then(function(nbrPlayers) {
                    serviceUsers = nbrPlayers;
                    if (serviceUsers > 0) {
                        postponeShutdown();
                    }
                }).catch(error => {
                    // Do nothing
                });
            }
            else {
                await new Promise(resolve => { shutdown(function(result) { resolve(); }); });
            }
        }
        else {
            serviceStatus = "stopped";
        }
        await sleep(5000);
    }
}
function fetchServerStatus() {
  return new Promise(resolve => {
    ec2.describeInstances({ InstanceIds: [config['instanceId']] }, function(err, data) {
        let content = ""
        if (err){
            content = "error"
        }
        else {
            content = data["Reservations"][0]["Instances"][0]["State"]["Name"];
            content = content;
        }
        resolve(content);
    });
  });
}
function fetchServiceStatus() {
  return new Promise(resolve => {
    let statusLogs = new circular_buffer(100);
    remoteExec('./status.sh', statusLogs,
        function(output) {
            resolve(statusLogs.toarray().join(''));
        },
        function(error) {
            resolve('unknown');
        }
    );
  });
}
function fetchMinecraftStats() {
    return new Promise(resolve => {
        minecraft_ping(config['minecraftHost'], parseInt(config['minecraftPort']), { connectTimeout: 3000 }, (error, response) => {
            if (error) {
                resolve(0);
            }
            else {
                resolve(response['onlinePlayers']);
            }
        });
    });
}
monitorServerForever();

// Launch the server
let server = app.listen(3000);