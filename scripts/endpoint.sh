cp ./uploads/$1 .
ls
docker build --build-arg FileZip=./uploads/$1 -t $2:1.0 .
rm $1
ls

