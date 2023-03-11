cd /
mkdir -p /homebackups
tar -zcvpf /homebackups/homebackup_$(date +%d-%m-%Y).tar.gz /home
exit 0

