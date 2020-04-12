#!/bin/bash
basedir="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
pid=`cat $basedir/pid`
kill -s SIGTERM $pid
