# Build the container
docker build -t my-chatgpt .

# Run the container
docker run -p 8080:8080 --env-file .env truong11t2/my-chatgpt:1.0.0


docker tag my-chatgpt:latest truong11t2/my-chatgpt:1.0.0
docker push truong11t2/my-chatgpt:1.0.0
docker pull truong11t2/my-chatgpt:1.0.0