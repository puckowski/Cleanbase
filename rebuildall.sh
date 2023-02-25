echo "Rebuild..."

while ! mysqladmin ping -h"localhost" --silent; do
    sleep 1
done

while [[ $(systemctl show --property ActiveState docker) != "ActiveState=active" ]]; do
    sleep 1
done

MYPATH=`dirname "$0"`
cd "$MYPATH"
sudo node "./rebuildservices.js"
sudo node "./rebuildallandrun.js"
sudo node "./server.js"
echo "Done"
exit 0

