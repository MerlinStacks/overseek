/** Keep old bookmarks and customer links understandable without loading the retired feature. */
export function RetiredWholesaleCatalogPage() {
    return <main className="mx-auto max-w-xl p-8 text-slate-900 dark:text-slate-100">
        <h1 className="text-xl font-semibold">Wholesale catalogs are no longer available</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">This feature has been retired. Existing catalog links can no longer be used.</p>
        <a href="/" className="mt-6 inline-block underline">Go to OverSeek</a>
    </main>;
}
