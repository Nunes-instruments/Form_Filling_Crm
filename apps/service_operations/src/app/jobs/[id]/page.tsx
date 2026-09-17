import JobEditor from '@/components/JobEditor';

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return <JobEditor jobId={id} autoPreview={query.preview === '1'} />;
}
