useradd -m -p password -s /bin/bash $1
passwd -d $1

sudo /changepass.sh $1 $2

sudo setquota -u $1 200M 220M 0 0 /

mkdir -p /usr/disk-images
cd /usr/disk-images

dd if=/dev/zero of=$1 bs=1M count=100
losetup -fP "$1"
mkfs.ext4 $1
DEV=$(losetup -a | grep -e "disk-images/$1)$" | cut -d ":" -f 1)
echo "Loop devices: "
echo $DEV
mkdir -p /home/$1/data
echo "Made /home/$1/data"
mount -o loop $DEV /home/$1/data
chown $1 /home/$1/data
