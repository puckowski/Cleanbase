cd /usr/disk-images
e2fsck -y /usr/disk-images/$1
losetup -fP "$1"
DEV=$(losetup -a | grep -e "disk-images/$1)$" | cut -d ":" -f 1)
echo "Loop devices: "
echo $DEV
mount -o loop $DEV /home/$1/data

