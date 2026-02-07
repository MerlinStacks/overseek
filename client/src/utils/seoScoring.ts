
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
        description: string;
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


    const addTest = (testName: string, passed: boolean, message: string, weight: number = 10) => {
        tests.push({ test: testName, passed, message });
        totalWeight += weight;
        if (passed) score += weight;
    };


    addTest('Product Title', name.length > 5, 'Title is too short', 10);

    addTest('Product Description', description.length > 50, 'Description is too short', 10);

    addTest('Images', images && images.length > 0, 'No images found', 15);
    addTest('Price', !!price && price !== '', 'Price is missing', 5);


    if (focusKeyword && focusKeyword.trim().length > 0) {
        const keywordLower = focusKeyword.toLowerCase();

        addTest(
            'Focus Keyword Set',
            true,
            'Focus keyword is set',
            0
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


        addTest(
            'Keyword in URL',
            permalink.toLowerCase().includes(keywordLower.replace(/ /g, '-')),
            'URL does not contain keyword',
            10
        );
    } else {

        addTest('Focus Keyword Set', false, 'Add a Focus Keyword to unlock full analysis', 0);
        totalWeight += 45;
    }


    const finalScore = totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;

    return {
        score: finalScore,
        tests
    };
}
