CONTAINERS=$(sudo docker container ls -q -f status=exited -a)
if test -z "$CONTAINERS" 
then
      echo "No containers"
else
      sudo docker rm $CONTAINERS
fi

exit 0
