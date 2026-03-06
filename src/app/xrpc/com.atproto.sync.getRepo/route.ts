import { NextResponse } from 'next/server';
import { GUEST_DID_PREFIX } from '@/lib/guest-identity';
import { getGuestRecordsForRepo } from '@/lib/firebase-client';
import { MemoryBlockstore, Repo, WriteOpAction, blocksToCarFile, type RecordCreateOp } from '@atproto/repo';
import type { Keypair } from '@atproto/crypto';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoDid = searchParams.get('repo');

  if (!repoDid) {
    return NextResponse.json(
      { error: 'InvalidRequest', message: 'repo DID is required' },
      { status: 400 }
    );
  }

  // We only serve guest DIDs from this local PDS replacement
  if (!repoDid.startsWith(GUEST_DID_PREFIX)) {
    return NextResponse.json(
      { error: 'RecordNotFound', message: `Not a local guest repository: ${repoDid}` },
      { status: 404 }
    );
  }

  try {
    const records = await getGuestRecordsForRepo(repoDid);
    
    if (!records || records.length === 0) {
      return NextResponse.json(
        { error: 'RepoNotFound', message: `Could not locate repo: ${repoDid}` },
        { status: 404 }
      );
    }

    // Build a temporary repo in memory to generate a CAR file
    const storage = new MemoryBlockstore();
    
    // We don't have the user's private key here (it's in their browser's localStorage),
    // but the relay needs the data. In a full PDS, we would have the keys or a way to sign.
    // For this "Guest PDS" simulation, we provide the records.
    // Note: To be fully compliant, the records should be signed by the user's key.
    // However, for the relay to just index the content, providing a CAR with the records is the first step.
    
    // Create an empty repo first
    // Since we can't sign properly without the key, we're essentially "reconstructing" 
    // what the repo should look like based on our DB.
    
    // Let's use a simplified approach: 
    // Real AT Protocol requires a signed root. 
    // For now, we'll try to package the records into a CAR.
    
    // Create a new Repo instance (this is a bit tricky without the signing key)
    // If this approach fails with the relay, we'll need to rethink the guest signing strategy.
    
    const unsignedKeypair: Keypair = {
      jwtAlg: 'ES256K',
      did() {
        return repoDid;
      },
      async sign(data: Uint8Array) {
        void data;
        // Dummy signature - this WILL fail formal verification but might allow
        // the relay to at least see the structure if it's not strictly verifying
        // every hop during a manual requestCrawl (unlikely, but worth a shot for guest mode).
        return new Uint8Array(64);
      },
    };

    const initialWrites: RecordCreateOp[] = records.map((rec) => ({
      action: WriteOpAction.Create,
      collection: rec.collection,
      rkey: rec.rkey,
      record: rec.value,
    }));
    const currentRepo = await Repo.create(storage, repoDid, unsignedKeypair, initialWrites);

    // Export the entire repo as a CAR file
    const carBytes = await blocksToCarFile(currentRepo.cid, storage.blocks);
    const carBuffer = Buffer.from(carBytes);

    return new Response(carBuffer, {
      headers: {
        'Content-Type': 'application/vnd.ipld.car',
        'Content-Length': carBuffer.length.toString(),
      },
    });

  } catch (err) {
    console.error('Error generating guest CAR:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to generate repository' },
      { status: 500 }
    );
  }
}
