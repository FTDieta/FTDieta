export const config = {

  api: {

    bodyParser: false,

  },

};

export default async function handler(req, res) {

  // Allow only POST requests

  if (req.method !== "POST") {

    return res.status(405).json({

      error: "Method not allowed",

    });

  }

  try {

    // Make sure the OpenAI API key exists

    if (!process.env.OPENAI_API_KEY) {

      return res.status(500).json({

        error: "OPENAI_API_KEY is not configured",

      });

    }

    // Read the uploaded multipart/form-data image

    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {

      return res.status(400).json({

        error: "Expected multipart/form-data",

      });

    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);

    if (!boundaryMatch) {

      return res.status(400).json({

        error: "Missing multipart boundary",

      });

    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];

    for await (const chunk of req) {

      chunks.push(chunk);

    }

    const bodyBuffer = Buffer.concat(chunks);

    // Convert multipart body to binary-safe string

    const bodyString = bodyBuffer.toString("latin1");

    const parts = bodyString.split("--" + boundary);

    let imageBuffer = null;

    let mimeType = "image/jpeg";

    for (const part of parts) {

      if (

        part.includes('name="image"') &&

        part.includes("Content-Type:")

      ) {

        const separator = "\r\n\r\n";

        const separatorIndex = part.indexOf(separator);

        if (separatorIndex === -1) {

          continue;

        }

        const headers = part.substring(0, separatorIndex);

        const mimeMatch = headers.match(

          /Content-Type:\s*([^\r\n]+)/i

        );

        if (mimeMatch) {

          mimeType = mimeMatch[1].trim();

        }

        let fileData = part.substring(

          separatorIndex + separator.length

        );

        // Remove trailing multipart CRLF

        if (fileData.endsWith("\r\n")) {

          fileData = fileData.slice(0, -2);

        }

        imageBuffer = Buffer.from(fileData, "latin1");

        break;

      }

    }

    if (!imageBuffer || imageBuffer.length === 0) {

      return res.status(400).json({

        error: "No image received",

      });

    }

    // Convert image to base64

    const base64Image = imageBuffer.toString("base64");

    const dataUrl =

      `data:${mimeType};base64,${base64Image}`;

    // Send image to OpenAI

    const openAIResponse = await fetch(

      "https://api.openai.com/v1/chat/completions",

      {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

          Authorization:

            `Bearer ${process.env.OPENAI_API_KEY}`,

        },

        body: JSON.stringify({

          model: "gpt-4.1-mini",

          response_format: {

            type: "json_object",

          },

          messages: [

            {

              role: "system",

              content:

                "You are a food nutrition analysis assistant. " +

                "Analyze the food shown in the photograph. " +

                "Identify the food or meal and estimate the total calories " +

                "for the visible portion. " +

                "Return ONLY valid JSON with exactly these fields: " +

                '{"foodName":"description of food","calories":number}. ' +

                "Calories must be a whole number. " +

                "If multiple foods are visible, describe the complete meal " +

                "and estimate the combined calories.",

            },

            {

              role: "user",

              content: [

                {

                  type: "text",

                  text:

                    "Analyze this food photo and estimate the calories.",

                },

                {

                  type: "image_url",

                  image_url: {

                    url: dataUrl,

                  },

                },

              ],

            },

          ],

          temperature: 0.2,

          max_tokens: 300,

        }),

      }

    );

    const openAIData = await openAIResponse.json();

    if (!openAIResponse.ok) {

      console.error(

        "OpenAI error:",

        JSON.stringify(openAIData)

      );

      return res.status(500).json({

        error: "Food analysis failed",

        details:

          openAIData?.error?.message ||

          "Unknown OpenAI error",

      });

    }

    const responseText =

      openAIData?.choices?.[0]?.message?.content;

    if (!responseText) {

      return res.status(500).json({

        error: "No analysis returned",

      });

    }

    let result;

    try {

      result = JSON.parse(responseText);

    } catch (error) {

      console.error(

        "Could not parse OpenAI response:",

        responseText

      );

      return res.status(500).json({

        error: "Could not understand analysis result",

      });

    }

    const foodName =

      result.foodName || "Food";

    const calories =

      Math.round(Number(result.calories));

    if (!Number.isFinite(calories)) {

      return res.status(500).json({

        error: "Invalid calorie estimate",

      });

    }

    // This matches what your index.html expects:

    // data.foodName

    // data.calories

    return res.status(200).json({

      foodName,

      calories,

    });

  } catch (error) {

    console.error("Analyze API error:", error);

    return res.status(500).json({

      error: "Unable to analyze the food photo",

      details: error.message,

    });

  }

}
