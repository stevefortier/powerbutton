#!/bin/bash
basedir="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
cd $basedir/minecraft
if test -f $basedir/pid
then
	pid=`cat $basedir/pid`
	if ps -p $pid > /dev/null
	then
	        exit 0
	fi
fi

(java -Xms4G -Xmx9G -jar forge-1.7.10-10.13.4.1614-1.7.10-universal.jar nogui -Dfml.readTimeout=320) &> $basedir/log & echo $! > $basedir/pid
