export async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!response.body || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Bounded response unavailable');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) throw new Error('Response exceeds byte limit'); chunks.push(value); } }
    catch (error) { await reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    const result = new Uint8Array(new ArrayBuffer(length)); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}
