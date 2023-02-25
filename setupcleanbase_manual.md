# Manual steps for Docker on second disk

## Update package manager and install packages

sudo apt-get update
sudo apt-get install -y xfsprogs

## Identify second disk

sudo fdisk -l

## Format second disk with xfs

If second disk is 'sdb', use a command like the following:
mkfs.xfs /dev/sdb

## Update boot filesystems

For second disk 'sdb', identify UUID:
blkid /dev/sdb

Edit fstab:
sudo nano /etc/fstab

Add new UUID to ftsab:
UUID=<> /var/lib/docker xfs defaults,quota,prjquota,pquota,gquota 0 0

## Stop Docker and clear data

sudo systemctl stop docker
sudo rm -rf /var/lib/docker

## Reboot and test

sudo reboot 0

Run Alpine with 12 megabytes of disk space allotted:
docker run --storage-opt size=12m -it alpine:latest sh

In Alpine, try to create a 100 megabyte file:
dd if/dev/zero of=foo bs=1 count=100

File creation should fail.
