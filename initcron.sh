#!/bin/bash

MY_PATH=$(pwd)

echo "$MY_PATH"

cronjob1="0,5,10,15,20,25,30,35,40,45,50,55  * * * * $MY_PATH/standalonerunstopped.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob1"; } | crontab -u root -

cronjob2="0  1 * * * $MY_PATH/backuphome.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob2"; } | crontab -u root -

cleanbasehome=$(pwd)
echo "CLEANBASEHOME=\"$cleanbasehome\"" >> /etc/environment

cronjob3="0  1 * * * BASH_ENV=/etc/environment $MY_PATH/backupuploads.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob3"; } | crontab -u root -

