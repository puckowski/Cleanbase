echo /home/$3/data
docker run --memory="128m" --cpus="1.0" --storage-opt size=50m -d -v /home/$3/data:/virtualdisk -p $2:80 $1

