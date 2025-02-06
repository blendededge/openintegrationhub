# Development Guide: Open Integration Hub on Apple Silicon (M1/M2/M3)

This guide helps developers set up and run the Open Integration Hub framework on Apple Silicon Macs (M1, M2, or M3 processors).

## Prerequisites

- macOS Sonoma (14.0) or later
- Homebrew package manager
- Docker Desktop for Apple Silicon
- Node.js LTS version (preferably installed via nvm)
- Git

## Initial Setup

1. Install Homebrew (if not already installed):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install Docker Desktop for Apple Silicon:
```bash
brew install --cask docker
```

3. Install Node Version Manager (nvm):
```bash
brew install nvm
```

## Minikube Setup

1. Install Minikube using Homebrew:
```bash
brew install minikube
```

2. Verify the installation:
```bash
which minikube
```

3. Clean up any existing Minikube instances:
```bash
# Kill any existing minikube tunnels
pkill -f "minikube tunnel"

# Stop and delete minikube
minikube stop
minikube delete
```

4. Start Minikube with required resources:
```bash
minikube start --memory 8192 --cpus 4 --vm=true --driver=docker
```

5. Enable required addons:
```bash
minikube addons enable ingress
minikube addons enable metrics-server
```

6. Verify kubectl is configured to use Minikube:
```bash
kubectl config current-context
```
The output should show `minikube`. If it doesn't, your kubectl might be pointing to a different cluster.

7. Run the OIH setup script:
```bash
# Important: The setup script must be run from within the minikube directory
cd dev-tools/minikube

# For Apple Silicon Macs, use these specific options
bash setup.sh -s meta-data-repository,analytics-service,app-directory,audit-log,data-hub,dispatcher-service,governance-service,logic-gateway,rds,reports-analytics,template-repository -d component-orchestrator -p
```

8. When prompted for tunnel access, approve it with your password.

Note: If you see any errors about tunnels already running or mount conflicts, follow the cleanup steps in step 3 and try again.

### Apple Silicon Specific Notes

- The setup uses Docker driver instead of hyperkit for better ARM64 compatibility
- Source code mounting is handled differently on Apple Silicon, using a direct mount to Docker
- Some services might need to be built specifically for ARM64 architecture

## Known Architecture Considerations

- Docker images must be compatible with ARM64 architecture
- Some Node.js native modules may require recompilation
- Rosetta 2 translation layer may be needed for specific x86_64 dependencies

## Development Workflow

### Developing Services from Source

When using the `-d` parameter to develop services from source (e.g., `-d component-orchestrator`), the setup script will:

1. Mount your local source code into the Kubernetes cluster
2. Install npm dependencies for the specified service
3. Deploy the service using the source code instead of a container image

Example:
```bash
cd dev-tools/minikube
bash setup.sh -d component-orchestrator -p
```

Common issues with source mounting:

1. **Missing package.json**: If you see this error:
```
npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /usr/src/app/package.json
```
This usually means the source code mounting failed. Solutions:
- Ensure you're running the script from the `dev-tools/minikube` directory
- Check that the service name matches exactly with the directory name
- Verify the source code path is correct in your repository

2. **Permission Issues**: If you see permission errors:
- Ensure your user has access to the source code directory
- Check that the mounted volume has the correct permissions

## Troubleshooting

### Common Issues

1. Architecture-specific Docker issues
2. Node.js native module compilation errors
3. Performance considerations
4. Minikube Mount Conflicts
5. Sed Command Differences
6. Service Startup Issues

#### Component Orchestrator CrashLoopBackOff

If you see `CrashLoopBackOff` for the component-orchestrator, check the logs:
```bash
kubectl logs -n oih-dev-ns deployment/component-orchestrator
```

Common fixes:
- Ensure all required environment variables are set
- Check MongoDB connection is established
- Verify RabbitMQ is accessible

#### Snapshots Service Not Starting

If the snapshots-service is not starting or restarting:
```bash
kubectl logs -n oih-dev-ns deployment/snapshots-service
```

The service may need additional time to connect to dependencies. If issues persist, try:
```bash
kubectl rollout restart -n oih-dev-ns deployment/snapshots-service
```

#### NPM Security Vulnerabilities

When you see npm security warnings during setup:
```
45 vulnerabilities (3 low, 17 moderate, 20 high, 5 critical)
```

For development environments, you can:
1. Review the audit report: `npm audit`
2. Fix non-breaking issues: `npm audit fix`
3. For production, address all issues: `npm audit fix --force`

Note: Always test thoroughly after fixing vulnerabilities as they may introduce breaking changes.

### Verifying Service Health

To check the status of all services:
```bash
kubectl get pods -n oih-dev-ns
```

To view logs for a specific service:
```bash
kubectl logs -n oih-dev-ns deployment/<service-name>
```

To restart a service:
```bash
kubectl rollout restart -n oih-dev-ns deployment/<service-name>
```

When encountering this error:
```
sed: 1: "./1.1-CodeVolume/source ...": invalid command code
```

This happens because macOS's `sed` command requires different syntax than Linux. The setup script has been updated to handle this automatically. If you encounter this error, make sure you're using the latest version of the setup script.

If you need to manually use `sed` commands in scripts, remember that on macOS:
```bash
# macOS (requires backup extension argument)
sed -i '' "s/old/new/" file

# Linux (no backup extension needed)
sed -i "s/old/new/" file
```

When running the setup script and encountering this error:
```