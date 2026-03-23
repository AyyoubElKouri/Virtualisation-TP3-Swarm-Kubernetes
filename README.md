# TP : Docker Swarm vs Kubernetes
### Comparaison de deux orchestrateurs de containers — API Task Manager en TypeScript/Node.js

---

## Table des matières

1. [C'est quoi un orchestrateur ?](#1-cest-quoi-un-orchestrateur-)
2. [Architecture du projet](#2-architecture-du-projet)
3. [L'application — Task Manager API](#3-lapplication--task-manager-api)
4. [Prérequis et installation des outils](#4-prérequis-et-installation-des-outils)
5. [Build de l'image Docker](#5-build-de-limage-docker)
6. [Partie 1 — Docker Swarm](#6-partie-1--docker-swarm-)
7. [Partie 2 — Kubernetes](#7-partie-2--kubernetes-️)
8. [Comparaison réseau — le cœur du TP](#8-comparaison-réseau--le-cœur-du-tp-)
9. [Tableau comparatif final](#9-tableau-comparatif-final)
10. [Nettoyage](#10-nettoyage)

---

## 1. C'est quoi un orchestrateur ?

### Le problème sans orchestrateur

Imagine que tu as une API qui tourne dans un container Docker. Si ce container plante à 3h du matin, ton application est morte — jusqu'à ce que quelqu'un remarque le problème et relance manuellement le container. C'est inacceptable en production.

De plus, si ton application reçoit beaucoup de trafic, un seul container ne suffit pas. Tu as besoin d'en lancer plusieurs en parallèle pour partager la charge.

C'est là qu'intervient un **orchestrateur de containers** : c'est un système qui :
- **Lance automatiquement** plusieurs copies (replicas) de ton application
- **Surveille** en permanence que les containers sont vivants
- **Recrée automatiquement** un container s'il plante (résilience)
- **Distribue le trafic** entre les replicas (load balancing)
- **Permet de scaler** facilement (augmenter/diminuer le nombre de replicas)

### Docker Swarm vs Kubernetes — différence en une phrase

- **Docker Swarm** : l'orchestrateur **intégré dans Docker**, simple à configurer, idéal pour des projets petits à moyens.
- **Kubernetes (K8s)** : l'orchestrateur de référence de l'industrie, plus complexe, mais beaucoup plus puissant et flexible, utilisé par Google, Netflix, etc.

---

## 2. Architecture du projet

```
tp3-docker-swarm-vs-kubernetes/
│
├── app/                        ← L'API TypeScript (commune aux deux orchestrateurs)
│   ├── src/
│   │   └── index.ts            ← Code source de l'API
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile              ← Recette pour construire l'image Docker
│
├── swarm/
│   └── docker-compose.yml      ← Configuration Docker Swarm
│
└── k8s/
    ├── deployment.yaml         ← Configuration du déploiement Kubernetes
    └── service.yaml            ← Configuration du réseau Kubernetes
```

> **Idée centrale du TP** : la même application tourne sur les deux orchestrateurs. On ne change pas le code, on ne change pas l'image Docker. Ce qui change, c'est uniquement la façon de décrire, déployer et gérer les containers.

---

## 3. L'application — Task Manager API

C'est une API REST simple avec 4 endpoints :

| Méthode | Route     | Description                                      |
|---------|-----------|--------------------------------------------------|
| GET     | `/health` | Healthcheck — retourne le nom du container/pod   |
| GET     | `/info`   | Infos système (hostname, uptime)                 |
| GET     | `/tasks`  | Liste toutes les tâches en mémoire               |
| POST    | `/tasks`  | Crée une nouvelle tâche `{ "title": "..." }`     |

### Pourquoi `hostname` dans les réponses ?

Chaque container/pod a un nom unique (son hostname). En incluant `servedBy: hostname` dans chaque réponse, on peut **voir visuellement quel container répond** à chaque requête. C'est ce qui nous permet de prouver que le load balancing fonctionne.



## 4. Prérequis et installation des outils

### 4.1 Docker (déjà installé)

```bash
docker --version
```

### 4.2 Installer `kubectl` — le client Kubernetes

`kubectl` est l'outil en ligne de commande pour parler à un cluster Kubernetes. C'est l'équivalent de la commande `docker` mais pour Kubernetes.

```bash
# Télécharger le binaire
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"

# Rendre exécutable
chmod +x kubectl

# Déplacer dans le PATH pour l'utiliser partout
sudo mv kubectl /usr/local/bin/

# Vérifier
kubectl version --client
```

### 4.3 Installer `minikube` — le cluster Kubernetes local

Kubernetes est normalement déployé sur plusieurs serveurs. Minikube crée un **mini-cluster Kubernetes simulé** sur ta machine locale, dans un container Docker. Parfait pour le développement et les TPs.

```bash
# Télécharger
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64

# Rendre exécutable et déplacer dans le PATH
chmod +x minikube-linux-amd64
sudo mv minikube-linux-amd64 /usr/local/bin/minikube

# Vérifier
minikube version
```

### 4.4 Démarrer Minikube

```bash
minikube start --driver=docker
```

> `--driver=docker` : Minikube a besoin d'un environnement pour s'exécuter. On lui dit d'utiliser Docker comme driver — ça crée un container Docker qui joue le rôle d'un serveur Kubernetes complet. Pas besoin de VirtualBox ou d'une vraie VM.

Ce que Minikube fait au démarrage :
- Crée un container Docker qui simule un nœud Kubernetes
- Installe à l'intérieur tous les composants K8s (API server, scheduler, etcd...)
- Configure le réseau CNI (Container Network Interface) pour que les pods puissent se parler
- Configure automatiquement `kubectl` pour se connecter à ce cluster

### 4.5 Ouvrir les ports pour Swarm (Fedora/RHEL uniquement)

Fedora a un pare-feu actif (firewalld) qui bloque les ports de Docker Swarm par défaut.

```bash
sudo firewall-cmd --add-port=3000/tcp --permanent   # Port de l'application
sudo firewall-cmd --add-port=2377/tcp --permanent   # Port de contrôle du Swarm
sudo firewall-cmd --add-port=7946/tcp --permanent   # Communication entre nœuds (TCP)
sudo firewall-cmd --add-port=7946/udp --permanent   # Communication entre nœuds (UDP)
sudo firewall-cmd --add-port=4789/udp --permanent   # Trafic réseau overlay (VXLAN)
sudo firewall-cmd --reload
```

> Le port `4789/udp` est particulièrement important : c'est le port **VXLAN**, le protocole que Docker Swarm utilise pour créer les réseaux overlay (réseaux virtuels distribués entre plusieurs machines).

---

## 5. Build de l'image Docker

### Construire l'image

```bash
cd app
docker build -t task-manager:latest .
cd ..
```

```bash
# Vérifier que l'image a été créée
docker images | grep task-manager
```

> `-t task-manager:latest` : le flag `-t` (tag) donne un nom à l'image. Le format est `nom:tag`. `latest` est le tag par défaut qui signifie "version la plus récente".

---

## 6. Partie 1 — Docker Swarm 🐝

### 6.1 Concepts fondamentaux de Swarm

| Concept | Définition simple |
|---|---|
| **Swarm** | Un cluster de machines Docker gérées ensemble |
| **Node** | Une machine dans le cluster (ici on en a une seule) |
| **Manager** | Le nœud qui prend les décisions (déploiement, surveillance...) |
| **Worker** | Un nœud qui exécute les containers (ici le manager fait aussi worker) |
| **Service** | La définition de ce qu'on veut déployer (image + nombre de replicas + config) |
| **Task / Replica** | Un container individuel qui fait partie d'un service |
| **Overlay Network** | Un réseau virtuel distribué sur tous les nœuds du swarm |
| **VIP** | Virtual IP — une IP unique pour le service qui cache les IPs réelles des replicas |

### 6.2 Initialiser le Swarm

```bash
docker swarm init
```

Cette commande transforme ton Docker Engine en **manager de Swarm**. Elle :
- Active le mode Swarm dans Docker
- Crée les clés cryptographiques pour sécuriser le cluster
- Affiche un token pour que d'autres machines puissent rejoindre le cluster (pas nécessaire pour ce TP)

### 6.3 Le fichier de configuration — `swarm/docker-compose.yml`

```yaml
version: "3.8"

networks:
  task-net:
    driver: overlay
    # overlay = réseau distribué sur tous les nœuds du swarm
    # Contrairement à "bridge" (local à une machine), overlay permet aux containers
    # de se parler par nom même s'ils sont sur des machines différentes

services:
  api:
    image: task-manager:latest
    networks:
      - task-net
    ports:
      - "3000:3000"
    deploy:
      replicas: 3                  # Maintenir 3 containers en permanence
      update_config:
        parallelism: 1             # Mettre à jour 1 container à la fois
        delay: 10s                 # Attendre 10s entre chaque mise à jour
      restart_policy:
        condition: on-failure      # Redémarrer si le container plante
        max_attempts: 3
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s                # Vérifier l'état toutes les 10s
      timeout: 5s                  # Considérer en échec si pas de réponse après 5s
      retries: 3                   # Après 3 échecs → container "unhealthy" → recréé
```

**Points importants :**
- `replicas: 3` : Swarm va **garantir** qu'il y a toujours 3 containers actifs. Si l'un meurt, il en recrée un automatiquement.
- `restart_policy` : définit le comportement en cas de plantage.
- `healthcheck` : Swarm appelle `/health` régulièrement. Si ça ne répond plus → container tué et recréé.
- `update_config` : lors d'une mise à jour de l'image, Swarm met à jour les containers **un par un** (rolling update) pour ne jamais couper le service.

### 6.4 Déployer le stack

```bash
docker stack deploy -c swarm/docker-compose.yml tp-swarm
```

> - `docker stack` : commande Swarm pour déployer un groupe de services (un "stack")
> - `-c swarm/docker-compose.yml` : le fichier de configuration
> - `tp-swarm` : le nom du stack (préfixe de tous les services créés)

### 6.5 Vérifier le déploiement

```bash
# Voir les services
docker service ls
```
Résultat attendu :
```
ID             NAME           MODE         REPLICAS   IMAGE                 PORTS
ud913246z2jb   tp-swarm_api   replicated   3/3        task-manager:latest   *:3000->3000/tcp
```
> `3/3` = 3 replicas demandés, 3 en cours d'exécution. ✅

```bash
# Voir les containers individuels (tasks)
docker service ps tp-swarm_api
```
Résultat attendu :
```
ID             NAME             IMAGE                 NODE      DESIRED STATE   CURRENT STATE
rbih8wsgzguh   tp-swarm_api.1   task-manager:latest   fedora    Running         Running 2 seconds ago
jd6nnczrv7jp   tp-swarm_api.2   task-manager:latest   fedora    Running         Running 2 seconds ago
r0fhqqz4ayrr   tp-swarm_api.3   task-manager:latest   fedora    Running         Running 2 seconds ago
```

```bash
# Voir les containers Docker réels
docker ps --filter "name=tp-swarm_api"
```

---

### 6.6 Test 1 — Load Balancing

```bash
for i in {1..6}; do curl -s http://127.0.0.1:3000/health; echo; done
```

> On utilise `127.0.0.1` (IPv4 explicite) plutôt que `localhost` qui peut se résoudre en IPv6 (`::1`) sur Fedora.

Résultat observé :
```json
{"status":"ok","hostname":"1cc2365dfd9c"}
{"status":"ok","hostname":"9b9bc8a02596"}
{"status":"ok","hostname":"2b43376dabf4"}
{"status":"ok","hostname":"1cc2365dfd9c"}   ← cycle recommence
{"status":"ok","hostname":"9b9bc8a02596"}
{"status":"ok","hostname":"2b43376dabf4"}
```

**Ce qu'on observe :** Les 6 requêtes sont distribuées en **round-robin strict** entre les 3 containers. C'est le **routing mesh** de Swarm — chaque requête qui arrive sur le port 3000 est automatiquement redirigée vers le prochain replica disponible, de façon cyclique.

---

### 6.7 Test 2 — Résilience (auto-restart)

```bash
# 1. Récupérer l'ID d'un container
docker ps --filter "name=tp-swarm_api" --format "table {{.ID}}\t{{.Names}}"

# 2. Tuer violemment un container (remplacer CONTAINER_ID)
docker kill CONTAINER_ID

# 3. Observer Swarm réagir en temps réel
watch -n 1 "docker service ps tp-swarm_api"
```

> `watch -n 1` relance la commande toutes les secondes. Appuie sur `Ctrl+C` pour quitter.

Résultat observé :
```
NAME             CURRENT STATE           ERROR
tp-swarm_api.1   Running 25 seconds ago          ← nouveau container recréé
tp-swarm_api.1   Shutdown 30 seconds ago         ← ancien container mort
tp-swarm_api.2   Running 2 minutes ago
tp-swarm_api.3   Running 2 minutes ago
```

**Ce qu'on observe :** En moins de 5 secondes, Swarm a détecté la mort du container et en a recréé un nouveau automatiquement. Le service n'a jamais été interrompu car les 2 autres replicas continuaient de répondre pendant ce temps.

---

### 6.8 Test 3 — Inspection réseau Swarm 🌐

```bash
# Lister tous les réseaux Docker
docker network ls
```

Résultat :
```
NETWORK ID     NAME                   DRIVER    SCOPE
yoxnf5m9ce44   ingress                overlay   swarm    ← réseau Swarm système
o6sar5rt8t85   tp-swarm_task-net      overlay   swarm    ← notre réseau applicatif
7a55646716f2   bridge                 bridge    local    ← réseau Docker normal
```

> Remarque la différence entre `bridge` (scope: `local`, limité à une machine) et `overlay` (scope: `swarm`, distribué sur tout le cluster).

```bash
# Inspecter en détail le réseau overlay
docker network inspect tp-swarm_task-net
```

Résultat clé :
```json
{
  "Driver": "overlay",
  "Scope": "swarm",
  "IPAM": {
    "Config": [{ "Subnet": "10.0.1.0/24", "Gateway": "10.0.1.1" }]
  },
  "Options": {
    "com.docker.network.driver.overlay.vxlanid_list": "4097"
  },
  "Containers": {
    "container_1": { "Name": "tp-swarm_api.1", "IPv4Address": "10.0.1.3/24" },
    "container_2": { "Name": "tp-swarm_api.2", "IPv4Address": "10.0.1.4/24" },
    "container_3": { "Name": "tp-swarm_api.3", "IPv4Address": "10.0.1.7/24" },
    "lb-tp-swarm_task-net": { "Name": "tp-swarm_task-net-endpoint", "IPv4Address": "10.0.1.6/24" }
  }
}
```

**Ce qu'on observe :**

| Élément | Valeur | Signification |
|---|---|---|
| `Driver: overlay` | — | Réseau distribué, pas local |
| `Scope: swarm` | — | Existe à l'échelle du cluster entier |
| `Subnet: 10.0.1.0/24` | — | Plage d'IPs dédiée au réseau virtuel |
| `vxlanid_list: 4097` | — | ID du tunnel VXLAN qui encapsule le trafic réseau entre nœuds |
| `tp-swarm_api.1` | `10.0.1.3` | IP individuelle du replica 1 |
| `tp-swarm_api.2` | `10.0.1.4` | IP individuelle du replica 2 |
| `tp-swarm_api.3` | `10.0.1.7` | IP individuelle du replica 3 |
| `lb-tp-swarm_task-net` | `10.0.1.6` | **VIP (Virtual IP)** du load balancer interne |

> **La VIP (Virtual IP)** est le mécanisme central du load balancing Swarm. Quand une requête arrive sur le port 3000, elle arrive sur cette IP virtuelle `10.0.1.6`. Swarm redirige ensuite la requête vers l'un des replicas (`10.0.1.3`, `.4`, ou `.7`). Le client ne voit jamais les IPs réelles des containers — il parle toujours à la VIP.

```bash
# Voir les deux réseaux auxquels chaque container est connecté
docker inspect $(docker ps --filter "name=tp-swarm_api" -q) \
  --format "{{.Name}} → IP: {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
```

Résultat :
```
/tp-swarm_api.3 → IP: 10.0.0.7  10.0.1.7
/tp-swarm_api.1 → IP: 10.0.0.4  10.0.1.3
/tp-swarm_api.2 → IP: 10.0.0.5  10.0.1.4
```

> Chaque container a **deux IPs** car il est connecté à deux réseaux :
> - `10.0.0.x` → réseau `ingress` (gère le trafic entrant depuis l'extérieur)
> - `10.0.1.x` → réseau `tp-swarm_task-net` (communication interne entre services)

---

### 6.9 Test 4 — Scaling

```bash
# Passer de 3 à 5 replicas
docker service scale tp-swarm_api=5

# Vérifier
docker service ls
```

Résultat :
```
ID             NAME           MODE         REPLICAS   IMAGE
ud913246z2jb   tp-swarm_api   replicated   5/5        task-manager:latest
```

En une seule commande, Swarm a lancé 2 containers supplémentaires. Pour redescendre :

```bash
docker service scale tp-swarm_api=3
```

---

## 7. Partie 2 — Kubernetes ☸️

### 7.1 Concepts fondamentaux de Kubernetes

| Concept | Définition simple | Équivalent Swarm |
|---|---|---|
| **Cluster** | Ensemble de machines gérées par K8s | Swarm |
| **Node** | Une machine dans le cluster | Node |
| **Pod** | Unité de base de K8s — un ou plusieurs containers | Task/Replica |
| **Deployment** | Objet qui décrit quoi déployer et combien de replicas | Section `deploy:` du compose |
| **ReplicaSet** | Composant interne qui maintient le bon nombre de pods | `restart_policy` |
| **Service** | Objet réseau qui expose les pods | Ports + VIP de Swarm |
| **ClusterIP** | IP virtuelle interne du Service | VIP Swarm |
| **NodePort** | Port exposé sur le nœud pour l'accès externe | `ports: "3000:3000"` |
| **CNI** | Container Network Interface — le système réseau de K8s | Overlay network |
| **Liveness Probe** | Vérifie si le container est vivant | `healthcheck` |
| **Readiness Probe** | Vérifie si le container est prêt à recevoir du trafic | (pas d'équivalent dans Swarm) |

**Différence fondamentale avec Swarm :** Dans Kubernetes, **tout est un objet séparé** décrit dans son propre fichier YAML. Le déploiement (Deployment), l'exposition réseau (Service), la configuration (ConfigMap), les secrets (Secret)... tout est découplé. C'est plus verbeux mais beaucoup plus flexible.

### 7.2 Charger l'image dans Minikube

Minikube tourne dans son propre container Docker isolé. Il ne voit **pas** les images que tu as buildées sur ta machine hôte. Il faut les lui transférer explicitement.

```bash
minikube start

minikube image load task-manager:latest

# Vérifier
minikube image ls | grep task-manager
```
### 7.5 Déployer sur Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

> `kubectl apply` est **déclaratif** : tu décris l'état désiré ("je veux 3 pods de cette image"), et Kubernetes se charge d'atteindre cet état. Si tu le relances, il met à jour ce qui a changé sans tout recréer.

```bash
# Vérifier les pods (attendre que STATUS = Running et READY = 1/1)
kubectl get pods
```

```
NAME                          READY   STATUS    RESTARTS   AGE
task-manager-fd89d6f7-5rc5j   1/1     Running   0          32s
task-manager-fd89d6f7-7dzpf   1/1     Running   0          32s
task-manager-fd89d6f7-wnq8m   1/1     Running   0          32s
```

> `1/1 READY` signifie : 1 container sur 1 attendu est prêt (la readiness probe a réussi).

```bash
# Vérifier le Service
kubectl get services
```

```
NAME                   TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)
kubernetes             ClusterIP   10.96.0.1      <none>        443/TCP
task-manager-service   NodePort    10.98.109.18   <none>        3000:30000/TCP
```

---

### 7.6 Test 1 — Load Balancing

```bash
# Récupérer l'IP de Minikube
minikube ip
# → 192.168.49.2

# Tester
for i in {1..6}; do curl -s http://$(minikube ip):30000/health; echo; done
```

Résultat observé :
```json
{"status":"ok","hostname":"task-manager-fd89d6f7-wnq8m"}
{"status":"ok","hostname":"task-manager-fd89d6f7-5rc5j"}
{"status":"ok","hostname":"task-manager-fd89d6f7-7dzpf"}
{"status":"ok","hostname":"task-manager-fd89d6f7-7dzpf"}
{"status":"ok","hostname":"task-manager-fd89d6f7-5rc5j"}
{"status":"ok","hostname":"task-manager-fd89d6f7-7dzpf"}
```

**Différence avec Swarm :** Le load balancing n'est **pas** en round-robin strict — la distribution est aléatoire. C'est parce que Kubernetes utilise des règles **iptables** pour router le trafic (ou ipvs selon la configuration), ce qui donne une distribution probabiliste plutôt que cyclique.

---

### 7.7 Test 2 — Résilience

```bash
# Supprimer un pod
kubectl delete pod task-manager-fd89d6f7-5rc5j

# Observer la recréation en temps réel
watch -n 1 "kubectl get pods"
```

Résultat :
```
NAME                          READY   STATUS    RESTARTS   AGE
task-manager-fd89d6f7-7dzpf   1/1     Running   0          3m
task-manager-fd89d6f7-wnq8m   1/1     Running   0          3m
task-manager-fd89d6f7-z64xl   1/1     Running   0          5s   ← nouveau pod
```

> Le pod `5rc5j` a disparu et `z64xl` l'a remplacé instantanément. C'est le **ReplicaSet** (créé automatiquement par le Deployment) qui surveille et maintient le bon nombre de pods. Remarque que le nouveau pod a un **suffixe différent** (`z64xl` au lieu de `5rc5j`) — chaque pod K8s a un nom unique généré automatiquement.

---

### 7.8 Test 3 — Inspection réseau Kubernetes 🌐

```bash
# Vue d'ensemble des services
kubectl get services
```

```bash
# Inspection détaillée du Service
kubectl describe service task-manager-service
```

Résultat clé :
```
Name:              task-manager-service
Selector:          app=task-manager
Type:              NodePort
IP:                10.98.109.18          ← ClusterIP (VIP interne)
Port:              3000/TCP
TargetPort:        3000/TCP
NodePort:          30000/TCP             ← Port externe
Endpoints:         10.244.0.3:3000,10.244.0.4:3000,10.244.0.6:3000
Session Affinity:  None
```

**Ce qu'on observe :**

| Élément | Valeur | Signification |
|---|---|---|
| `ClusterIP` | `10.98.109.18` | IP virtuelle interne (équivalent VIP Swarm), mais **visible et explicite** |
| `Endpoints` | `10.244.0.3`, `.4`, `.6` | IPs réelles de chaque pod — liste maintenue à jour automatiquement |
| `Selector` | `app=task-manager` | K8s trouve les pods via leurs labels, pas via leur nom |
| `NodePort` | `30000` | Port accessible depuis l'extérieur du cluster |

> **Différence clé avec Swarm :** Dans Swarm, la VIP est cachée dans le réseau overlay et difficile à inspecter. Dans Kubernetes, la **ClusterIP et les Endpoints sont des objets de première classe**, visibles et inspectables avec `kubectl describe`. C'est beaucoup plus transparent.

```bash
# Voir l'IP individuelle de chaque pod
kubectl get pods -o wide
```

Résultat :
```
NAME                          READY   IP           NODE
task-manager-fd89d6f7-7dzpf   1/1     10.244.0.4   minikube
task-manager-fd89d6f7-wnq8m   1/1     10.244.0.3   minikube
task-manager-fd89d6f7-z64xl   1/1     10.244.0.6   minikube
```

> Les pods sont dans le sous-réseau `10.244.0.0/16` — c'est le réseau **CNI** (Container Network Interface) de Minikube, l'équivalent fonctionnel du réseau overlay VXLAN de Swarm. La différence est que CNI est un standard K8s qui peut être implémenté par différents plugins (Flannel, Calico, Cilium...), tandis que Swarm utilise toujours son propre VXLAN.

```bash
# Infos sur le cluster et le nœud
kubectl cluster-info
kubectl get nodes -o wide
```

---

### 7.9 Test 4 — Scaling

```bash
# Passer à 5 pods
kubectl scale deployment task-manager --replicas=5

# Observer
kubectl get pods -o wide
```

Résultat :
```
NAME                          READY   STATUS    IP           NODE
task-manager-fd89d6f7-7dzpf   1/1     Running   10.244.0.4   minikube
task-manager-fd89d6f7-gszpm   1/1     Running   10.244.0.8   minikube
task-manager-fd89d6f7-vsl2v   0/1     Running   10.244.0.7   minikube   ← readiness probe en cours
task-manager-fd89d6f7-wnq8m   1/1     Running   10.244.0.3   minikube
task-manager-fd89d6f7-z64xl   1/1     Running   10.244.0.6   minikube
```

> Note : le pod `vsl2v` est en `0/1 READY` — il tourne mais la **readiness probe** n'a pas encore validé qu'il est prêt à recevoir du trafic. K8s ne lui envoie pas de requêtes pendant cette phase. C'est un comportement qu'on ne peut pas observer aussi finement avec Swarm.

---

### 7.10 Test 5 — Le comportement Stateless

```bash
# Créer une tâche
curl -s -X POST http://$(minikube ip):30000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Finir le TP"}' | python3 -m json.tool

# Lire les tâches immédiatement après
curl -s http://$(minikube ip):30000/tasks | python3 -m json.tool
```

Résultat :
```json
// POST → servedBy: task-manager-fd89d6f7-vsl2v
{ "task": { "id": 1, "title": "Finir le TP" }, "servedBy": "vsl2v" }

// GET → servedBy: task-manager-fd89d6f7-gszpm  ← pod DIFFÉRENT !
{ "tasks": [], "count": 0, "servedBy": "gszpm" }
```

**Ce qu'on observe :** La tâche a été créée sur le pod `vsl2v` et stockée **dans sa mémoire**. La requête GET a été dirigée vers un **pod différent** (`gszpm`) qui n'a pas cette tâche en mémoire → liste vide.

> Ce comportement est **identique sur Swarm**. C'est une propriété fondamentale des applications containerisées : les pods/containers sont **stateless** (sans état persistant). En production, on résout ce problème en externalisant le stockage des données dans une base de données partagée (PostgreSQL, MongoDB, Redis...) qui est indépendante des pods.

---

## 8. Comparaison réseau — le cœur du TP 🌐

C'est la partie que ton professeur a mentionnée : "inspecter le réseau".

### Swarm — Architecture réseau

```
Internet / Machine hôte
        │
        │ Port 3000
        ▼
┌─────────────────────────────────────────────┐
│           Routing Mesh (Swarm)              │  ← reçoit le trafic sur port 3000
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │   Réseau Overlay (VXLAN 10.0.1.0/24) │   │
│  │                                      │   │
│  │  VIP 10.0.1.6 (Load Balancer)        │   │  ← IP virtuelle cachée
│  │       │                              │   │
│  │  ┌────┴────────────────────────┐     │   │
│  │  ▼            ▼               ▼     │   │
│  │ api.1        api.2           api.3  │   │
│  │ 10.0.1.3    10.0.1.4        10.0.1.7│   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Kubernetes — Architecture réseau

```
Internet / Machine hôte
        │
        │ Port 30000 (NodePort)
        ▼
┌─────────────────────────────────────────────┐
│           Node Minikube (192.168.49.2)      │
│                                             │
│  Service: ClusterIP 10.98.109.18            │  ← IP virtuelle VISIBLE et inspectable
│  Endpoints: 10.244.0.3, .4, .6             │  ← liste des pods EXPLICITE
│       │                                     │
│  ┌────┴────────────────────────┐            │
│  │  Réseau CNI (10.244.0.0/16) │            │
│  │  ▼            ▼            ▼ │            │
│  │ pod-1        pod-2        pod-3│          │
│  │ 10.244.0.3  10.244.0.4  10.244.0.6│      │
│  └─────────────────────────────┘            │
└─────────────────────────────────────────────┘
```

---

## 10. Nettoyage

### Arrêter Kubernetes

```bash
# Supprimer le déploiement et le service
kubectl delete -f k8s/deployment.yaml
kubectl delete -f k8s/service.yaml

# Arrêter Minikube
minikube stop
```

### Arrêter Swarm

```bash
# Supprimer le stack
docker stack rm tp-swarm

# Attendre quelques secondes que les containers s'arrêtent
sleep 5

# Quitter le mode Swarm
docker swarm leave --force
```

### Vérification finale

```bash
# Vérifier qu'il n'y a plus de containers qui tournent
docker ps

# Vérifier que Swarm est bien désactivé
docker info | grep -i swarm
# → Swarm: inactive
```
