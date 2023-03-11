echo "Start setup..."

sudo apt-get update

sudo add-apt-repository multiverse
sudo apt-get update

sudo apt install -y mariadb-server
sudo service mysql start

sudo apt install -y dos2unix

sudo dos2unix ./maria-init/mariadb-init.txt 
sudo ./maria-init/mariadb-init.txt 
sudo dos2unix ./maria-init/mariadb-init-2.txt 
sudo ./maria-init/mariadb-init-2.txt
sudo dos2unix ./maria-init/mariadb-init-3.txt 
sudo cp ./maria-init/init.ddl /tmp
sudo ./maria-init/mariadb-init-3.txt 

sudo apt install -y virtualbox-guest-dkms virtualbox-guest-x11

sudo apt-get install -y cron curl
sudo systemctl start cron
sudo systemctl enable cron

sudo apt update

sudo sed -i 's/GRUB_CMDLINE_LINUX=""/GRUB_CMDLINE_LINUX="rootflags=pquota"/' /etc/fstab
sudo update-grub

sudo apt install -y quota
quota --version
sudo sed -i 's/defaults/usrquota,grpquota/' /etc/fstab
sudo sed -i 's/errors=remount-ro/usrquota,grpquota,errors=remount-ro/' /etc/fstab
sudo mount -o remount /
cat /proc/mounts | grep ' / '
sudo quotacheck -ugm /
sudo modprobe quota_v1 -S $(find /lib/modules/ -type f -name '*quota_v*.ko' | sort -r | grep -m1 'v1' | cut -f 4 -d '/')
sudo modprobe quota_v2 -S $(find /lib/modules/ -type f -name '*quota_v*.ko' | sort -r | grep -m1 'v2' | cut -f 4 -d '/')
sudo quotaon -v /

sudo curl -fsSL https://deb.nodesource.com/setup_16.x | sudo bash -
sudo apt-get install -y nodejs

sudo apt-get -y install nano
sudo apt-get install -y ca-certificates gnupg lsb-release
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
sudo echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io


sudo echo "deb [trusted=yes arch=amd64] https://download.konghq.com/insomnia-ubuntu/ default all" \
    | sudo tee -a /etc/apt/sources.list.d/insomnia.list
sudo apt-get update
sudo apt-get install insomnia

sudo ./scripts/initcron.sh
sudo cp ./scripts/changepass.sh /
    
echo "Finish setup... reboot when ready"
