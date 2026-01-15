export const dynamic = "force-dynamic";

import InternalDocsList from "../../../components/assets/InternalDocsList";

export default async function Page({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <InternalDocsList productId={productId} />;
}
