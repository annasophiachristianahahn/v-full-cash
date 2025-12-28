import { Response } from 'express';
import { jobManager } from './jobManager';
import { autoRunService } from './autoRun';

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: Date;
}

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.setupJobManagerListeners();
    this.setupAutoRunListeners();
    this.startHeartbeat();
  }

  private setupJobManagerListeners() {
    jobManager.on('state:change', (state) => {
      this.broadcast('state', state);
    });

    jobManager.on('job:created', (job) => {
      this.broadcast('job:created', job);
    });

    jobManager.on('job:started', (job) => {
      this.broadcast('job:started', job);
    });

    jobManager.on('job:progress', (job) => {
      this.broadcast('job:progress', job);
    });

    jobManager.on('job:completed', (job) => {
      this.broadcast('job:completed', job);
    });

    jobManager.on('job:failed', (job) => {
      this.broadcast('job:failed', job);
    });

    jobManager.on('job:cancelled', (job) => {
      this.broadcast('job:cancelled', job);
    });
  }

  private setupAutoRunListeners() {
    autoRunService.on('state:change', (state) => {
      this.broadcast('autorun:state', state);
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('heartbeat', { 
        timestamp: new Date().toISOString(),
        clients: this.clients.size
      });
    }, 30000);
  }

  async addClient(id: string, res: Response): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    const client: SSEClient = {
      id,
      res,
      connectedAt: new Date()
    };

    this.clients.set(id, client);

    this.sendToClient(id, 'connected', { 
      clientId: id,
      timestamp: new Date().toISOString()
    });

    this.sendToClient(id, 'state', jobManager.getFullState());
    this.sendToClient(id, 'autorun:state', autoRunService.getState());

    const schedulerModule = await import('./scheduler');
    this.sendToClient(id, 'scheduler:state', schedulerModule.schedulerService.getState());

    res.on('close', () => {
      this.removeClient(id);
    });

    console.log(`SSE client connected: ${id} (total: ${this.clients.size})`);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    console.log(`SSE client disconnected: ${id} (total: ${this.clients.size})`);
  }

  private sendToClient(clientId: string, event: string, data: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error(`Error sending SSE to client ${clientId}:`, error);
      this.removeClient(clientId);
    }
  }

  broadcast(event: string, data: any): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    
    const entries = Array.from(this.clients.entries());
    for (const [id, client] of entries) {
      try {
        client.res.write(message);
      } catch (error) {
        console.error(`Error broadcasting to client ${id}:`, error);
        this.removeClient(id);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  broadcastSchedulerState(state: any): void {
    this.broadcast('scheduler:state', state);
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    const entries = Array.from(this.clients.entries());
    for (const [id, client] of entries) {
      try {
        client.res.end();
      } catch (error) {
      }
    }
    
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();
