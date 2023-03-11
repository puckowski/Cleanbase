#!/bin/bash

MY_PATH=$(pwd)

echo "$MY_PATH"

cronjob4="@reboot cd $MY_PATH && $MY_PATH/scripts/rebuildall.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob4"; } | crontab -u root -

cronjob1="0,5,10,15,20,25,30,35,40,45,50,55  * * * * cd $MY_PATH && $MY_PATH/scripts/standalonerunstopped.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob1"; } | crontab -u root -

cronjob2="0  1 * * * cd $MY_PATH && $MY_PATH/scripts/backuphome.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob2"; } | crontab -u root -

cleanbasehome=$(pwd)
echo "CLEANBASEHOME=\"$cleanbasehome\"" >> /etc/environment

cronjob3="0  1 * * * BASH_ENV=/etc/environment cd $MY_PATH && $MY_PATH/scripts/backupuploads.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob3"; } | crontab -u root -

