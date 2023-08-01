import { Neurosity } from "@neurosity/sdk";
import { Session, SupabaseClient, createClient } from "@supabase/supabase-js";
import express from "express";
const app = express();
const port = process.env.PORT || 3001;

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const listenToBrain = async (token: string, timeoutMs = 3000) => {
    const neurosity = new Neurosity();
    await neurosity.login({customToken: token});
    let isReceivingFocus = false;

    const u1 = neurosity.brainwaves("powerByBand").subscribe(async (powerByBand) => {
        isReceivingFocus = true;

        console.log("powerByBand", powerByBand);
        const nf = {
            metadata: {
                ...powerByBand
            },
            user_id: token,
        }
        const { error } = await supabase.from('states').insert(nf)
        if (error) {
            console.log("error", error);
            try {
                u1.unsubscribe();
            } catch { }
            console.log("unsubscribed");
        }
    })

    const u2 = neurosity.focus().subscribe(async (focus) => {
        isReceivingFocus = true;

        console.log("focus", focus);
        const nf = {
            probability: focus.probability,
            metadata: {
                label: focus.label,
            },
            user_id: token,
        }
        const { error } = await supabase.from('states').insert(nf)
        if (error) {
            console.log("error", error);
            try {
                u2.unsubscribe();
            } catch { }
            console.log("unsubscribed");
        }
    });

    await new Promise((resolve, reject) => {
        setTimeout(() => {
            if (isReceivingFocus) {
                resolve(null);
            } else {
                u1.unsubscribe();
                u2.unsubscribe();
                reject(new Error("No data received from brainwaves in the specified timeout"));
            }
        }, timeoutMs);
    });

    return { unsubscribe1: u1.unsubscribe, unsubscribe2: u2.unsubscribe };
}

const getAllTokensAndListen = async () => {
    const { data: tokens, error } = await supabase.from('tokens').select('token');

    if (error) {
        console.log("error", error);
        return;
    }

    for (const token of tokens) {
        listenToBrain(token.token)
            .catch(async error => {
                console.log("Error listening to brain for token:", token, error);

                // If listening fails, remove the token from the database.
                const { error: deleteError } = await supabase.from('tokens').delete().eq('token', token);

                if (deleteError) {
                    console.log("Error removing token from database:", token, deleteError);
                }
            });
    }
}


getAllTokensAndListen();
