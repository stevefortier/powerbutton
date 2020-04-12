#!/bin/bash
basedir="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
tail -n 100 -f $basedir/log
