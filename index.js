const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const sha1 = require("js-sha1");

const dir = `./static`;
const dirPrices = `./static/prices`;
const dirPricehistory = `./static/pricehistory`;
const itemsApiBase = "https://cs2-api.vercel.app/api/en";
const marketBaseURL = "https://steamcommunity.com/market";

if (process.argv.length != 4) {
    console.error(`Missing input arguments, expected 4 got ${process.argv.length}`);
    process.exit(1);
}

const directories = [dir, dirPrices, dirPricehistory];

directories.forEach(directory => {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }
});

let community = new SteamCommunity();

console.log("Logging into Steam...");

community.login(
    {
        accountName: process.argv[2],
        password: process.argv[3],
    },
    async (err) => {
        if (err) {
            console.log("login:", err);
            return;
        }

        try {
            console.log("Loading items...");
            const items = await getAllItemNames();
            console.log(`Processing ${items.length} items.`);
            await processItems(items);

            fs.writeFile(
                `${dirPrices}/latest.json`,
                JSON.stringify(priceDataByItemHashName, null, 4),
                (err) => err && console.error(err)
            );
        } catch (error) {
            console.error("An error occurred while processing items:", error);
        }
    }
);

const priceDataByItemHashName = {};

async function getAllItemNames() {
    const endpoints = [
        "skins_not_grouped.json",
        "stickers.json",
        "crates.json",
        "agents.json",
        /*   "keys.json",           */
        "patches.json",
        "graffiti.json",
        "music_kits.json",
        "collectibles.json"
    ];

    try {
        const fetchPromises = endpoints.map(endpoint => fetch(`${itemsApiBase}/${endpoint}`).then(res => res.json()));
        const results = await Promise.all(fetchPromises);

        return results
            .flat()
            .filter(Boolean)
            .map(item => item.market_hash_name);
    } catch (error) {
        console.error("An error occurred while fetching item names:", error);
        return [];
    }
}

async function fetchPrice(name) {
    return new Promise((resolve, reject) => {
        community.request.get(`${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`,
            (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    if (res.statusCode > 400) {
                        console.log('[ERROR]', res.statusCode, res.statusMessage);
                        console.log(`${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`);
                        resolve([]);
                    }

                    const prices = (JSON.parse(res.body).prices || []).map(
                        ([time, value, volume]) => ({
                            time: Date.parse(time),
                            value,
                            volume: parseInt(volume),
                        })
                    );
                    resolve(prices);
                } catch (parseError) {
                    reject(parseError);
                }
            }
        );
    });
}

async function processBatch(batch) {
    const promises = batch.map((name) =>
        fetchPrice(name)
            .then((prices) => {
                if (prices.length > 0) {
                    priceDataByItemHashName[name] = {
                        steam: getWeightedAveragePrice(prices),
                    };
                    const hashedName = sha1(name);
                    const filteredPrices = prices.splice(-500);
                    return fs.writeFile(
                        `${dir}/pricehistory/${hashedName}.json`,
                        JSON.stringify(filteredPrices),
                        (err) => err && console.error(err)
                    );
                }
            })
            .catch((error) => console.log(`Error processing ${name}:`, error))
    );
    await Promise.all(promises);
}

async function processItems(items, batchSize = 1) {
    const requestsPerMinute = 30;
    const delayPerBatch = (60 / requestsPerMinute) * batchSize * 1000;

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await processBatch(batch);
        console.log(`Processed batch ${i / batchSize + 1}/${Math.ceil(items.length / batchSize)}`);

        if (i + batchSize < items.length) {
            console.log(`Waiting for ${delayPerBatch / 1000} seconds to respect rate limit...`);
            await new Promise((resolve) => setTimeout(resolve, delayPerBatch));
        }
    }
}

function getWeightedAveragePrice(data) {
    const now = Date.now();

    const calculateWAP = (days) => {
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
    };
}