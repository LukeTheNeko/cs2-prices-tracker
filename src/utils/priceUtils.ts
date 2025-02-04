export function getWeightedAveragePrice(data: { time: number; value: number; volume: number }[], lastEver?: number | null) {
    const now = Date.now();

    const calculateWAP = (days: number) => {
        const limit = now - days * 24 * 60 * 60 * 1000;
        let totalVolume = 0;
        let totalPriceVolumeProduct = 0;

        data.forEach(({ time, value, volume }) => {
            if (time >= limit) {
                totalPriceVolumeProduct += value * volume;
                totalVolume += volume;
            }
        });

        return totalVolume > 0 ? totalPriceVolumeProduct / totalVolume : null;
    };

    return {
        last_24h: calculateWAP(1),
        last_7d: calculateWAP(7),
        last_30d: calculateWAP(30),
        last_90d: calculateWAP(90),
        last_ever: lastEver
    };
}
