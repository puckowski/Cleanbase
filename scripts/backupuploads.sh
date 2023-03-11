cd /
mkdir -p /uploadbackups
tar -zcvpf /uploadbackups/uploadbackup_$(date +%d-%m-%Y).tar.gz $CLEANBASEHOME
printenv > /home/dan/Documents/env1.txt
exit 0

