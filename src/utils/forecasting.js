
// Simple Linear Regression to project future sales
// Input: Array of { date: Date, value: number }
// Output: Array of { date: Date, value: number, isForecast: true }

export const calculateForecast = (historicalData, daysToForecast = 30) => {
    if (!historicalData || historicalData.length < 2) return [];

    // 1. Prepare Data (X = day index, Y = value)
    const n = historicalData.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    const lastDate = new Date(historicalData[historicalData.length - 1].date);

    historicalData.forEach((point, i) => {
        const x = i;
        const y = point.sales; // Using sales property
        sumX += x;
        sumY += y;
        sumXY += (x * y);
        sumXX += (x * x);
    });

    // 2. Calculate Slope (m) and Intercept (b)
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // 3. Generate Forecast
    const forecast = [];

    // We start forecasting from the next day
    for (let i = 1; i <= daysToForecast; i++) {
        const x = n + i - 1; // n is length, so last index was n-1. 
        // Logic: if today is index 29 (day 30), tomorrow is index 30.

        const predictedValue = Math.max(0, slope * x + intercept); // Prevent negative sales

        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + i);

        forecast.push({
            name: nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            date: nextDate,
            sales: 0, // No actual sales
            forecast: predictedValue,
            isForecast: true
        });
    }

    return {
        forecastPoints: forecast,
        trend: slope,
        expectedTotal: forecast.reduce((a, b) => a + b.forecast, 0)
    };
};
