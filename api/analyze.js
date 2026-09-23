export const config = {

  api: {

    bodyParser: false,

  },

};

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({

      error: "Method not allowed",

    });

  }

  try {

    if (!process.env.OPENAI_API_KEY) {

      return res.status(500).json({

        error: "OPENAI_API_KEY is not configured",

      });

    }

    // Read multipart/form-data

    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {

      return res.status(400).json({

        error: "Expected multipart/form-data",

      });

    }

    const boundaryMatch = contentType.match(

      /boundary=(?:"([^"]+)"|([^;]+))/

    );

    if (!boundaryMatch) {

      return res.status(400).json({

        error: "Missing multipart boundary",

      });

    }

    const boundary =

      boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];

    for await (const chunk of req) {

      chunks.push(chunk);

    }

    const bodyBuffer = Buffer.concat(chunks);

    const bodyString =

      bodyBuffer.toString("latin1");

    const parts =

      bodyString.split("--" + boundary);

    let imageBuffer = null;

    let mimeType = "image/jpeg";

    for (const part of parts) {

      if (

        part.includes('name="image"') &&

        part.includes("Content-Type:")

      ) {

        const separator = "\r\n\r\n";

        const separatorIndex =

          part.indexOf(separator);

        if (separatorIndex === -1) {

          continue;

        }

        const headers =

          part.substring(0, separatorIndex);

        const mimeMatch = headers.match(

          /Content-Type:\s*([^\r\n]+)/i

        );

        if (mimeMatch) {

          mimeType = mimeMatch[1].trim();

        }

        let fileData = part.substring(

          separatorIndex + separator.length

        );

        if (fileData.endsWith("\r\n")) {

          fileData = fileData.slice(0, -2);

        }

        imageBuffer =

          Buffer.from(fileData, "latin1");

        break;

      }

    }

    if (!imageBuffer || imageBuffer.length === 0) {

      return res.status(400).json({

        error: "No image received",

      });

    }

    // Convert photo to base64 data URL

    const base64Image =

      imageBuffer.toString("base64");

    const dataUrl =

      `data:${mimeType};base64,${base64Image}`;

    // Send photo to OpenAI Responses API

    const openAIResponse = await fetch(

      "https://api.openai.com/v1/responses",

      {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

          Authorization:

            `Bearer ${process.env.OPENAI_API_KEY}`,

        },

        body: JSON.stringify({

          model: "gpt-5.6-luna",

          input: [

            {

              role: "user",

              content: [

                {

                  type: "input_text",

                  text:

                    "Analyze this food photograph. " +

                    "Identify the visible food or meal and " +

                    "estimate the total calories for the " +

                    "visible portion. Return ONLY valid JSON " +

                    "in exactly this format: " +

                    '{"foodName":"description","calories":500}. ' +

                    "Calories must be a whole number. " +

                    "If several foods are visible, describe " +

                    "the complete meal and estimate their " +

                    "combined calories."

                },

                {

                  type: "input_image",

                  image_url: dataUrl

                }

              ]

            }

          ],

          max_output_tokens: 300

        })

      }

    );

    const openAIData =

      await openAIResponse.json();

    if (!openAIResponse.ok) {

      console.error(

        "OpenAI error:",

        JSON.stringify(openAIData)

      );

      return res.status(500).json({

        error: "Food analysis failed",

        details:

          openAIData?.error?.message ||

          "Unknown OpenAI error"

      });

    }

    // Extract text from Responses API

    let responseText = "";

    if (openAIData.output_text) {

      responseText = openAIData.output_text;

    } else if (Array.isArray(openAIData.output)) {

      for (const item of openAIData.output) {

        if (!Array.isArray(item.content)) {

          continue;

        }

        for (const content of item.content) {

          if (

            content.type === "output_text" &&

            content.text

          ) {

            responseText += content.text;

          }

        }

      }

    }

    if (!responseText) {

      return res.status(500).json({

        error: "No analysis returned"

      });

    }

    // Remove possible markdown fences

    responseText = responseText

      .replace(/```json/gi, "")

      .replace(/```/g, "")

      .trim();

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

        details: responseText

      });

    }

    const foodName =

      result.foodName || "Food";

    const calories =

      Math.round(Number(result.calories));

    if (!Number.isFinite(calories)) {

      return res.status(500).json({

        error: "Invalid calorie estimate"

      });

    }

    // Return exactly what index.html expects

    return res.status(200).json({

      foodName,

      calories

    });

  } catch (error) {

    console.error(

      "Analyze API error:",

      error

    );

    return res.status(500).json({

      error: "Unable to analyze the food photo",

      details: error.message

    });

  }

}
