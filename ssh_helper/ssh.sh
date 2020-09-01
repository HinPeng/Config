#!/bin/bash

if [ $# == 0 ];then
    echo "Please specify the server at least"
    exit 1
fi

if [ $# == 1 ];then
    server=$1
    python ssh.py -t ${server}
else
    server=$1
    file=$2
    python ssh.py -t ${server} -f ${file}
fi
