import { collection, doc, setDoc, getDocs, query, where, orderBy, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { GUEST_DID_PREFIX } from "@/lib/guest-identity";

export interface AtprotoRecordDoc {
  uri: string;
  repo: string;
  collection: string;
  rkey: string;
  value: Record<string, unknown>;
  createdAt: string;
}

export async function writeGuestRecord(
  repo: string,
  collectionName: string,
  rkey: string,
  value: Record<string, unknown>,
  createdAt: string = new Date().toISOString()
) {
  console.log("writeGuestRecord called with:", { repo, collectionName, rkey });
  if (!repo.startsWith(GUEST_DID_PREFIX)) return;
  
  const docId = `${repo}_${collectionName}_${rkey}`;
  const uri = `at://${repo}/${collectionName}/${rkey}`;
  
  const docRef = doc(collection(db, "atproto_records"), docId);
  // Ensure the value is a plain JavaScript object by serializing and deserializing.
  // This strips any non-serializable class instances (like RecordSchema from @atproto/lex)
  const plainValue = JSON.parse(JSON.stringify(value));

  await setDoc(docRef, {
    uri,
    repo,
    collection: collectionName,
    rkey,
    value: plainValue,
    createdAt
  });
  
  return { uri, docId };
}

export async function getGuestRecord(repo: string, collectionName: string, rkey: string) {
  const docId = `${repo}_${collectionName}_${rkey}`;
  const docRef = doc(collection(db, "atproto_records"), docId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return snapshot.data() as AtprotoRecordDoc;
}

export async function getGuestCommentsForArticle(articleUri: string) {
  const q = query(
    collection(db, "atproto_records"),
    where("collection", "==", "app.bsky.feed.post")
  );
  
  const snapshot = await getDocs(q);
  const comments: AtprotoRecordDoc[] = [];
  
  snapshot.forEach((doc) => {
    const data = doc.data() as AtprotoRecordDoc;
    const value = data.value;
    
    if (value && typeof value === 'object') {
      const reply = (value as Record<string, unknown>).reply as Record<string, unknown> | undefined;
      const root = reply?.root as Record<string, unknown> | undefined;
      if (root?.uri === articleUri) {
        comments.push(data);
      }
    }
  });
  
  return comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getRecentGuestArticles(limit: number = 20) {
  // To avoid complex composite indexes initially, we fetch recent records and filter in-memory if needed.
  // We can query just by collection and order by createdAt.
  const q = query(
    collection(db, "atproto_records"),
    where("collection", "==", "sci.peer.article"),
  );
  
  const snapshot = await getDocs(q);
  const articles: AtprotoRecordDoc[] = [];
  
  snapshot.forEach((doc) => {
    articles.push(doc.data() as AtprotoRecordDoc);
  });
  
  return articles
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function getGuestRecordsForRepo(repo: string) {
  const q = query(
    collection(db, "atproto_records"),
    where("repo", "==", repo)
  );
  
  const snapshot = await getDocs(q);
  const records: AtprotoRecordDoc[] = [];
  
  snapshot.forEach((doc) => {
    records.push(doc.data() as AtprotoRecordDoc);
  });
  
  return records;
}

export async function getAllGuestDids() {
  const q = query(
    collection(db, "atproto_records"),
  );
  
  const snapshot = await getDocs(q);
  const dids = new Set<string>();
  
  snapshot.forEach((doc) => {
    const data = doc.data() as AtprotoRecordDoc;
    if (data.repo && data.repo.startsWith(GUEST_DID_PREFIX)) {
      dids.add(data.repo);
    }
  });
  
  return Array.from(dids).map(did => ({ did }));
}
