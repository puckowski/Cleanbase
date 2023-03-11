if [ $(unzip -l build.zip | awk 'BEGIN {sum=0} {sum+=$2} END {print sum}') -lt 250000 ]; then 
    exit 0; 
else 
    exit 1; 
fi
