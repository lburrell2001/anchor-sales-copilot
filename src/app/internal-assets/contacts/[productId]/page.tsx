export const dynamic = "force-dynamic";

import InternalContactsList from "../../../components/assets/InternalContactsList";

export default async function Page({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <InternalContactsList productId={productId} />;
}
