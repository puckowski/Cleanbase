echo "Rebuild..."
MYPATH=`dirname "$0"`
cd "$MYPATH"
sudo node "./rebuildservices.js"
sudo node "./rebuildallandrun.js"
sudo node "./server.js"
echo "Done"
exit 0

