// In-memory status tracker for real-time progress updates
// Maps requestId -> status updates

interface StatusUpdate {
  step: string;
  message: string;
  timestamp: number;
  progress?: number; // 0-100
}

const statusMap = new Map<string, StatusUpdate[]>();

export function addStatus(requestId: string, step: string, message: string, progress?: number) {
  if (!statusMap.has(requestId)) {
    statusMap.set(requestId, []);
  }
  
  const updates = statusMap.get(requestId)!;
  updates.push({
    step,
    message,
    timestamp: Date.now(),
    progress
  });
  
  // Keep only last 50 updates per request
  if (updates.length > 50) {
    updates.shift();
  }
  
  console.log(`[status:${requestId}] ${step}: ${message}`);
}

export function getStatus(requestId: string): StatusUpdate | null {
  const updates = statusMap.get(requestId);
  if (!updates || updates.length === 0) return null;
  return updates[updates.length - 1]; // Return latest
}

export function getAllStatus(requestId: string): StatusUpdate[] {
  return statusMap.get(requestId) || [];
}

export function clearStatus(requestId: string) {
  statusMap.delete(requestId);
}

// Cleanup old statuses (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [requestId, updates] of statusMap.entries()) {
    const latest = updates[updates.length - 1];
    if (latest && latest.timestamp < oneHourAgo) {
      statusMap.delete(requestId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

