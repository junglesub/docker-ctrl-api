> [!NOTE]  
> ⚠️ Disclaimer: This is my first time building an API using Elysia, so there may be mistakes and plenty of room for improvement. If you're experienced with Elysia or see anything that could be done better, feel free to open an issue — I'm eager to learn and improve!

# 🚀 Docker Control API

Docker Control API is a lightweight API server for managing and updating Docker containers. Built with TypeScript and powered by the Elysia framework, it offers streamlined container orchestration for simple, self-hosted environments.

> Pull, restart, and rollback Docker services via HTTP API.

## ✨ Features

- 🔄 Update and rollback containers with image version tracking
- 🔃 Update GitHub commit status to reflect deployment result
- 🔐 API key authentication for secure requests
- ✨ Enhanced Docker image pulling with exponential backoff retries for CDN propagation delays and transient network issues.
- (Planned) Implement Rolling deployment
- (Planned) Better API-Key Encryption
- (Planned) Use Github APP to set Github statuses

## ⚙️ Requirements

- [Bun](https://bun.sh/)
- Docker
- Node.js (for development)

## 🛠 Installation

```bash
# Clone the repository
git clone https://github.com/junglesub/docker-ctrl-api.git
cd docker-ctrl-api

# Install dependencies
bun install
```

## 🌐 Environment Variables

The following environment variable is optional and only needed for GitHub integration:

- `GITHUB_TOKEN` — used to authenticate and update commit statuses on GitHub. If this is not set, deployments still run and GitHub status updates are skipped.

### Configuration

Create a `config.yml` file with your service definitions and API keys:

```yaml
keys:
  myApp:
    container_name: test_feed
    secret_key: abc123
```

This path defaults to `./config.yml` but can be overridden by setting the `CONFIG_PATH` environment variable.

## 🚀 Development Server

Start the development server with:

```bash
bun run dev
```

The server runs on `http://localhost:3000` by default.

## 📡 API Endpoints

### Update Container

**POST** `/update?id=myApp`

#### Headers

- `x-api-key`: Your API key

### Query

- `id`: Key in `config.yml` file.

#### Body

```json
{
  "gh": {
    "commitSha": "your-commit-sha",
    "githubRepo": "owner/repo"
  }
}
```

#### Response

- Success: `"ok"`
- Failure: HTTP error status with message

## 🐳 Docker Support

### Run Container

```bash
docker run -p 3000:3000 -v ./config.yml:/app/config.yml -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/junglesub/docker-ctrl-api:latest
```

> Ensure the container has access to the Docker socket:
> `-v /var/run/docker.sock:/var/run/docker.sock`

## 🔁 GitHub Actions

CI/CD is integrated via GitHub Actions. A push to the `main` branch triggers a Docker image build and push to GitHub Container Registry.

## 🧪 Testing

Test scenarios are defined in the `.bruno` directory. Use [Bruno](https://www.usebruno.com/) to send and validate requests.

## 🛡 Security

- API key authentication
- Service name validation to prevent command injection
- No full Docker control exposure — only deployment actions

## 📜 License

This project is licensed under the [MIT License](./LICENSE).

## 🙌 Contributions

Contributions and feedback are welcome! Help us make lightweight Docker orchestration accessible for everyone.
