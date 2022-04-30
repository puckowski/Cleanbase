sudo docker container ls --format "{{.Ports}}" -a | grep -oe ':::.*->' > runningports.txt
exit 0
