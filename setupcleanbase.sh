echo "Start setup..."

sudo apt-get update

sudo add-apt-repository multiverse
sudo apt-get update

sudo apt install -y virtualbox-guest-dkms virtualbox-guest-x11

sudo apt-get install -y cron curl
sudo curl -fsSL https://deb.nodesource.com/setup_16.x | sudo bash -
sudo apt-get install -y nodejs
sudo apt install -y mariadb-server dos2unix quota
sudo apt-get -y install nano
sudo apt-get install -y ca-certificates gnupg lsb-release
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
sudo echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
sudo service mysql start
sudo dos2unix ./maria-init/mariadb-init.txt 
sudo ./maria-init/mariadb-init.txt 
sudo dos2unix ./maria-init/mariadb-init-2.txt 
sudo ./maria-init/mariadb-init-2.txt
sudo dos2unix ./maria-init/mariadb-init-3.txt 
sudo cp ./maria-init/init.ddl /tmp
sudo ./maria-init/mariadb-init-3.txt 
sudo echo "deb [trusted=yes arch=amd64] https://download.konghq.com/insomnia-ubuntu/ default all" \
    | sudo tee -a /etc/apt/sources.list.d/insomnia.list
sudo apt-get update
sudo apt-get install insomnia
sudo ./initcron.sh
    
echo "Finish setup"

