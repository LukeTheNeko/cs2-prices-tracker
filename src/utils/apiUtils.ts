import SteamCommunity from "steamcommunity";
import * as colors from 'colors';

const itemsBaseUrl = "https://api.cs2data.info/en"; // CS2 DATA API
const marketBaseURL = "https://steamcommunity.com/market";

export async function getAllItemNames(): Promise<string[]> {
    const endpoints = [
        "skins_not_grouped.json",
        "stickers.json",
        "crates.json",
        "agents.json",
        "keys.json",
        "patches.json",
        "graffiti.json",
        "music_kits.json",
        "collectibles.json",
        "keychains.json"
    ];

    try {
        const fetchPromises = endpoints.map(endpoint =>
            fetch(`${itemsBaseUrl}/${endpoint}`).then(res => res.json())
        );
        const results = await Promise.all(fetchPromises);

        return results
            .flat()
            .filter(Boolean)
            .map((item: any) => item.market_hash_name);
    } catch (error) {
        console.log(colors.red("An error occurred while fetching item names:" + error));
        return [];
    }
}

export async function fetchPrice(community: SteamCommunity, name: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        community.httpRequestGet(
            `${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`,
            (err: Error | null, res: any, body: string) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    if (res.statusCode === 429) {
                        console.log("ERROR", res.statusCode, res.statusMessage);
                        console.log(`${marketBaseURL}/pricehistory/?appid=730&market_hash_name=${encodeURIComponent(name)}`);
                        resolve([]);
                    }

                    const prices = (JSON.parse(body).prices || []).map(
                        ([time, value, volume]: [string, number, string]) => ({
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
