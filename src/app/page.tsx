import { WorkspaceApp } from "@/components/workspace/WorkspaceApp";
import { getSession } from "@/lib/auth/session";
import { getAccountHandle, getRecentArticles } from "@/lib/db/queries";

export default async function Home() {
  const session = await getSession();
  const [articles, accountHandle] = await Promise.all([
    getRecentArticles(50),
    session ? getAccountHandle(session.did) : Promise.resolve(null),
  ]);

  return (
    <WorkspaceApp
      initialArticles={articles}
      sessionDid={session?.did ?? null}
      accountHandle={accountHandle}
    />
  );
}
