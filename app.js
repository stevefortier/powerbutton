var AWS = require("aws-sdk");
const http = require('http');
const express = require('express')


AWS.config.getCredentials(function(err) {
    if (err) {
        console.log("Error discovering AWS credentials", err.stack);
    }
    else {
        console.log("Access key:", AWS.config.credentials.accessKeyId);
        console.log("Secret access key:", AWS.config.credentials.secretAccessKey);
    }
});
AWS.config.update({region: 'us-east-2'});

var ec2 = new AWS.EC2({apiVersion: 'latest'});

var params = {
    InstanceIds: ["i-aslkdjaslkjdlskjd"]
};

let app = express();

app.use(express.static('public'));

app.get('/', function(req, res) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end("content");
});

app.get('/status', function(req, res) {
    ec2.describeInstanceStatus(params, function(err, data) {
        let content = ""
        if (err){
            console.log(err, err.stack);
            content = "error"
        }
        else {
            console.log(JSON.stringify(data));
            content = JSON.stringify(data);
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(content);
    });
});

let server = app.listen(3000);