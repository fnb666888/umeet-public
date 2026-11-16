import { AdminWorkspace } from '../../components/admin/AdminWorkspace';
import { adminBootstrap } from '../../lib/admin-bootstrap-server';

export const metadata = { title: '社区管理 · Umeet' };
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminWorkspace initialData={await adminBootstrap(await searchParams)} />;
}
