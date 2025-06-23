class ARMarkerDetector {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.status = document.getElementById('status');
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.arObjects = [];
        this.currentObjectType = 0;
        this.objectTypes = ['cube', 'sphere', 'pyramid'];
        
        // Custom model properties
        this.customModel = null;
        this.customModelLoaded = false;
        this.useCustomModel = false;
        
        // Loaders
        this.gltfLoader = new THREE.GLTFLoader();
        this.objLoader = new THREE.OBJLoader();
        this.fbxLoader = new THREE.FBXLoader();
        
        this.isDetecting = false;
        this.stream = null;
        
        this.initThreeJS();
        this.setupCanvas();
    }
    
    initThreeJS() {
        // Create scene
        this.scene = new THREE.Scene();
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75, window.innerWidth / window.innerHeight, 0.1, 1000
        );
        
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas,
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        
        // Add lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
        
        // Start render loop
        this.animate();
    }
    
    setupCanvas() {
        const resizeCanvas = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }
    
    async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.video.srcObject = this.stream;
            this.video.play();
            
            this.video.onloadedmetadata = () => {
                this.updateStatus('Camera started successfully!', 'success');
                this.isDetecting = true;
                this.detectMarkers();
            };
            
        } catch (error) {
            this.updateStatus('Camera access denied or not available', 'error');
            console.error('Camera error:', error);
        }
    }
    
    detectMarkers() {
        if (!this.isDetecting || this.video.videoWidth === 0) {
            requestAnimationFrame(() => this.detectMarkers());
            return;
        }
        
        // Create a temporary canvas for image processing
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = this.video.videoWidth;
        tempCanvas.height = this.video.videoHeight;
        
        // Draw video frame
        tempCtx.drawImage(this.video, 0, 0);
        
        // Get image data for processing
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Simple edge detection and rectangle finding
        const rectangles = this.findRectangles(imageData);
        
        // Clear previous AR objects
        this.clearARObjects();
        
        // Create AR objects for detected rectangles
        rectangles.forEach((rect, index) => {
            this.createARObject(rect, index);
        });
        
        if (rectangles.length > 0) {
            this.updateStatus(`Detected ${rectangles.length} marker(s)`, 'success');
        } else {
            this.updateStatus('Scanning for markers...', 'info');
        }
        
        requestAnimationFrame(() => this.detectMarkers());
    }
    
    findRectangles(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        
        // Simple edge detection using Sobel operator
        const edges = new Uint8Array(width * height);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;
                
                // Convert to grayscale
                const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
                
                // Sobel X
                const sobelX = 
                    -1 * this.getGray(data, x-1, y-1, width) + 1 * this.getGray(data, x+1, y-1, width) +
                    -2 * this.getGray(data, x-1, y, width) + 2 * this.getGray(data, x+1, y, width) +
                    -1 * this.getGray(data, x-1, y+1, width) + 1 * this.getGray(data, x+1, y+1, width);
                
                // Sobel Y
                const sobelY = 
                    -1 * this.getGray(data, x-1, y-1, width) + -2 * this.getGray(data, x, y-1, width) + -1 * this.getGray(data, x+1, y-1, width) +
                    1 * this.getGray(data, x-1, y+1, width) + 2 * this.getGray(data, x, y+1, width) + 1 * this.getGray(data, x+1, y+1, width);
                
                const magnitude = Math.sqrt(sobelX * sobelX + sobelY * sobelY);
                edges[y * width + x] = magnitude > 50 ? 255 : 0;
            }
        }
        
        // Find rectangular contours (simplified)
        const rectangles = [];
        const minSize = Math.min(width, height) * 0.1;
        const maxSize = Math.min(width, height) * 0.8;
        
        // Sample some potential rectangles based on edge density
        for (let attempts = 0; attempts < 20; attempts++) {
            const x = Math.random() * (width - minSize);
            const y = Math.random() * (height - minSize);
            const w = minSize + Math.random() * (maxSize - minSize);
            const h = minSize + Math.random() * (maxSize - minSize);
            
            if (x + w < width && y + h < height) {
                const edgeScore = this.calculateEdgeScore(edges, x, y, w, h, width);
                if (edgeScore > 0.3) {
                    rectangles.push({
                        x: x / width,
                        y: y / height,
                        width: w / width,
                        height: h / height,
                        score: edgeScore
                    });
                }
            }
        }
        
        // Sort by score and return top rectangles
        return rectangles.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    
    getGray(data, x, y, width) {
        const i = (y * width + x) * 4;
        return (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    
    calculateEdgeScore(edges, x, y, w, h, width) {
        let edgeCount = 0;
        let totalPixels = 0;
        
        // Check perimeter for edges
        const step = 5;
        
        // Top and bottom edges
        for (let i = x; i < x + w; i += step) {
            if (edges[Math.floor(y) * width + Math.floor(i)] > 0) edgeCount++;
            if (edges[Math.floor(y + h) * width + Math.floor(i)] > 0) edgeCount++;
            totalPixels += 2;
        }
        
        // Left and right edges
        for (let i = y; i < y + h; i += step) {
            if (edges[Math.floor(i) * width + Math.floor(x)] > 0) edgeCount++;
            if (edges[Math.floor(i) * width + Math.floor(x + w)] > 0) edgeCount++;
            totalPixels += 2;
        }
        
        return totalPixels > 0 ? edgeCount / totalPixels : 0;
    }
    
    createARObject(rect, index) {
        const object = this.create3DObject();
        
        // Position object based on marker position
        const x = (rect.x - 0.5) * 10;
        const y = -(rect.y - 0.5) * 10;
        const z = -5;
        
        object.position.set(x, y, z);
        object.scale.set(rect.width * 5, rect.height * 5, 1);
        
        // Add rotation animation
        object.userData = {
            rotationSpeed: 0.02 + index * 0.01,
            originalScale: object.scale.clone()
        };
        
        this.scene.add(object);
        this.arObjects.push(object);
    }
    
    create3DObject() {
        if (this.useCustomModel && this.customModel) {
            // Clone the custom model
            const clonedModel = this.customModel.clone();
            
            // Ensure proper scaling for custom models
            const box = new THREE.Box3().setFromObject(clonedModel);
            const size = box.getSize(new THREE.Vector3());
            const maxDimension = Math.max(size.x, size.y, size.z);
            const scaleFactor = 2 / maxDimension; // Scale to fit in a 2-unit cube
            clonedModel.scale.setScalar(scaleFactor);
            
            return clonedModel;
        } else {
            // Use default geometric shapes
            const type = this.objectTypes[this.currentObjectType];
            let geometry, material;
            
            material = new THREE.MeshPhongMaterial({
                color: new THREE.Color().setHSL(Math.random(), 0.7, 0.6),
                shininess: 100
            });
            
            switch (type) {
                case 'cube':
                    geometry = new THREE.BoxGeometry(1, 1, 1);
                    break;
                case 'sphere':
                    geometry = new THREE.SphereGeometry(0.5, 16, 16);
                    break;
                case 'pyramid':
                    geometry = new THREE.ConeGeometry(0.5, 1, 4);
                    break;
                default:
                    geometry = new THREE.BoxGeometry(1, 1, 1);
            }
            
            return new THREE.Mesh(geometry, material);
        }
    }
    
    clearARObjects() {
        this.arObjects.forEach(obj => {
            this.scene.remove(obj);
            obj.geometry.dispose();
            obj.material.dispose();
        });
        this.arObjects = [];
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Animate AR objects
        this.arObjects.forEach(obj => {
            if (obj.userData.rotationSpeed) {
                obj.rotation.x += obj.userData.rotationSpeed;
                obj.rotation.y += obj.userData.rotationSpeed * 0.7;
                
                // Pulsing effect
                const scale = 1 + Math.sin(Date.now() * 0.005) * 0.1;
                obj.scale.copy(obj.userData.originalScale).multiplyScalar(scale);
            }
        });
        
        this.renderer.render(this.scene, this.camera);
    }
    
    toggleDetection() {
        this.isDetecting = !this.isDetecting;
        this.updateStatus(
            this.isDetecting ? 'Detection enabled' : 'Detection paused',
            this.isDetecting ? 'success' : 'info'
        );
    }
    
    changeObject() {
        if (this.useCustomModel) {
            this.updateStatus('Using custom model', 'success');
        } else {
            this.currentObjectType = (this.currentObjectType + 1) % this.objectTypes.length;
            this.updateStatus(
                `Changed to ${this.objectTypes[this.currentObjectType]}`,
                'success'
            );
        }
    }
    
    loadCustomModel(file) {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();
        
        reader.onload = (event) => {
            const arrayBuffer = event.target.result;
            
            try {
                switch (fileExtension) {
                    case 'glb':
                    case 'gltf':
                        this.loadGLTFModel(arrayBuffer, file.name);
                        break;
                    case 'obj':
                        this.loadOBJModel(arrayBuffer);
                        break;
                    case 'fbx':
                        this.loadFBXModel(arrayBuffer);
                        break;
                    default:
                        this.updateStatus('Unsupported file format', 'error');
                        return;
                }
            } catch (error) {
                this.updateStatus('Error loading model: ' + error.message, 'error');
            }
        };
        
        reader.readAsArrayBuffer(file);
        this.updateStatus('Loading model...', 'info');
    }
    
    loadGLTFModel(arrayBuffer, filename) {
        this.gltfLoader.parse(arrayBuffer, '', (gltf) => {
            this.customModel = gltf.scene;
            this.customModelLoaded = true;
            this.useCustomModel = true;
            this.updateStatus(`Custom model loaded: ${filename}`, 'success');
            this.addModelInfo(filename);
        }, (error) => {
            this.updateStatus('Error loading GLTF model', 'error');
            console.error('GLTF loading error:', error);
        });
    }
    
    loadOBJModel(arrayBuffer) {
        const text = new TextDecoder().decode(arrayBuffer);
        try {
            this.customModel = this.objLoader.parse(text);
            this.customModelLoaded = true;
            this.useCustomModel = true;
            this.updateStatus('Custom OBJ model loaded', 'success');
            this.addModelInfo('OBJ Model');
        } catch (error) {
            this.updateStatus('Error loading OBJ model', 'error');
            console.error('OBJ loading error:', error);
        }
    }
    
    loadFBXModel(arrayBuffer) {
        try {
            this.customModel = this.fbxLoader.parse(arrayBuffer);
            this.customModelLoaded = true;
            this.useCustomModel = true;
            this.updateStatus('Custom FBX model loaded', 'success');
            this.addModelInfo('FBX Model');
        } catch (error) {
            this.updateStatus('Error loading FBX model', 'error');
            console.error('FBX loading error:', error);
        }
    }
    
    addModelInfo(filename) {
        // Remove existing model info if any
        const existingInfo = document.querySelector('.model-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        // Add new model info
        const controls = document.getElementById('controls');
        const modelInfo = document.createElement('div');
        modelInfo.className = 'model-info';
        modelInfo.innerHTML = `✓ Custom Model: ${filename}`;
        controls.appendChild(modelInfo);
    }
    
    resetToDefault() {
        this.useCustomModel = false;
        this.currentObjectType = 0;
        this.updateStatus('Switched to default shapes', 'success');
        
        // Remove model info
        const existingInfo = document.querySelector('.model-info');
        if (existingInfo) {
            existingInfo.remove();
        }
    }
    
    updateStatus(message, type = 'info') {
        this.status.textContent = message;
        this.status.className = `status ${type}`;
    }
}

// Initialize AR system
const arSystem = new ARMarkerDetector();

// Global functions for buttons
function startCamera() {
    arSystem.startCamera();
}

function toggleDetection() {
    arSystem.toggleDetection();
}

function changeObject() {
    arSystem.changeObject();
}

function resetToDefault() {
    arSystem.resetToDefault();
}

function loadCustomModel(event) {
    const file = event.target.files[0];
    if (file) {
        arSystem.loadCustomModel(file);
    }
}

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        arSystem.isDetecting = false;
    } else if (arSystem.stream) {
        arSystem.isDetecting = true;
    }
});

// Handle device orientation changes
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        arSystem.setupCanvas();
    }, 100);
});

// Add error handling for WebGL context loss
arSystem.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    arSystem.updateStatus('WebGL context lost - refresh page', 'error');
});

arSystem.renderer.domElement.addEventListener('webglcontextrestored', () => {
    arSystem.initThreeJS();
    arSystem.updateStatus('WebGL context restored', 'success');
});