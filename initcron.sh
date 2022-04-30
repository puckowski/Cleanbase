#!/bin/bash

cronjob1="0,5,10,15,20,25,30,35,40,45,50,55  * * * * /home/dan/Documents/standalonerunstopped.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob1"; } | crontab -u root -

cronjob2="0  1 * * * /home/dan/Documents/backuphome.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob2"; } | crontab -u root -

cleanbasehome=$(pwd)
echo "CLEANBASEHOME=\"$cleanbasehome\"" >> /etc/environment

cronjob3="0  1 * * * BASH_ENV=/etc/environment /home/dan/Documents/backupuploads.sh"
{ crontab -l -u root 2>/dev/null; echo "$cronjob3"; } | crontab -u root -

