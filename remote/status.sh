#!/bin/bash
basedir="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
if test -f $basedir/pid
then
	pid=`cat $basedir/pid`
	if ps -p $pid > /dev/null
	then
	        echo "running"
	else
	        echo "stopped"
	fi
else
	echo "stopped"
fi
