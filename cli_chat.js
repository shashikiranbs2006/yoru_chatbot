import fetch from "node-fetch";

const ask = async () => {
  const question = process.argv.slice(2).join(" ");

  if (!question) {
    console.log("Enter a question");
    process.exit(1);
  }

  try {
    const response = await fetch("http://localhost:4000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });

    const data = await response.json();

    console.log("\nQUESTION:");
    console.log(question);

    console.log("\nANSWER:");
    console.log(data.answer);

    console.log("\nSOURCE PDF:");
    console.log(data.source || "No source found");

    console.log("\n");

  } catch (err) {
    console.error("Error:", err.message);
  }
};

ask();
