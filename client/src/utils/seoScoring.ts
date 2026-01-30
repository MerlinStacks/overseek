
export interface SeoAnalysisResult {
    score: number;
    tests: {
        test: string;
        passed: boolean;
        message: string;
    }[];
}

export function calculateSeoScore(
    data: {
        name: string;
        description: string; // Description + Short Description
        permalink: string;
        images: any[];
        price: string;
    },
    focusKeyword?: string
): SeoAnalysisResult {
    const tests: { test: string; passed: boolean; message: string }[] = [];
    let score = 0;
    let totalWeight = 0;

    const { name, description, permalink, images, price } = data;

    // Helper to add test
    const addTest = (testName: string, passed: boolean, message: string, weight: number = 10) => {
        tests.push({ test: testName, passed, message });
        totalWeight += weight;
        if (passed) score += weight;
    };

    // 1. Basic Content Checks
    addTest('Product Title', name.length > 5, 'Title is too short', 10);
    // Combine desc + short desc for the check, or just check if *either* has content?
    // Backend logic: description.length > 50 || shortDescription.length > 50
    // We'll assume the passed 'description' param might be a concatenation or we check it directly. 
    // To match backend exactly, the caller should pass the combined length or we'll need to change the signature.
    // Let's stick to the signature and assume caller passes combined or we rename to be clear.
    // Actually, backend: `description.length > 50 || shortDescription.length > 50`.
    // Let's rely on the caller passing the "effective" description content logic, or better yet, let's update the signature to take both.
    // But for now, let's treat the 'description' argument as "Effective Description Content"
    addTest('Product Description', description.length > 50, 'Description is too short', 10);

    addTest('Images', images && images.length > 0, 'No images found', 15);
    addTest('Price', !!price && price !== '', 'Price is missing', 5);

    // 2. Keyword Checks (if keyword provided)
    if (focusKeyword && focusKeyword.trim().length > 0) {
        const keywordLower = focusKeyword.toLowerCase();

        addTest(
            'Focus Keyword Set',
            true,
            'Focus keyword is set',
            0 // Backend doesn't weight this, but we show it as passed
        );

        addTest(
            'Keyword in Title',
            name.toLowerCase().includes(keywordLower),
            `Title does not contain focus keyword "${focusKeyword}"`,
            20
        );

        addTest(
            'Keyword in Description',
            description.toLowerCase().includes(keywordLower),
            `Description does not contain focus keyword`,
            15
        );

        // Permalinks are often just the slug in this context, or full URL.
        // We'll handle both by just checking inclusion.
        addTest(
            'Keyword in URL',
            permalink.toLowerCase().includes(keywordLower.replace(/ /g, '-')),
            'URL does not contain keyword',
            10
        );
    } else {
        // Warning if no keyword
        addTest('Focus Keyword Set', false, 'Add a Focus Keyword to unlock full analysis', 0);
        totalWeight += 45; // The weight of the missing keyword tests (20 + 15 + 10)
    }

    // Normalize Score to 100
    const finalScore = totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;

    return {
        score: finalScore,
        tests
    };
}
