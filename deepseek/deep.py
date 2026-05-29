import torch
from transformers import pipeline

# Use a free, small, CPU-friendly text-generation model from Hugging Face.
model_name = "distilgpt2"

pipe = pipeline(
    "text-generation",
    model=model_name,
    device_map="auto" if torch.cuda.is_available() else None,
)

prompt = "Who are you?"
result = pipe(prompt, max_new_tokens=50, do_sample=False)
print(result[0]["generated_text"].strip())